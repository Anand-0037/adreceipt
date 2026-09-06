import { describe, expect } from 'bun:test'
import { hexToBase64, type TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem'
import { configSchema, initWorkflow, onCronTrigger } from './workflow'
import { hashQuote, hashSubject, type Config } from './quote'

const config: Config = {
	schedule: '0 */1 * * * *',
	schemaVersion: 1,
	quoteId: `0x${'11'.repeat(32)}`,
	campaignId: `0x${'22'.repeat(32)}`,
	subjectHash: `0x${'33'.repeat(32)}`,
	subject: { publisher: `0x${'99'.repeat(20)}`, placementId: `0x${'aa'.repeat(32)}`,
		productRefHash: `0x${'44'.repeat(32)}`, contentHash: `0x${'bb'.repeat(32)}`, disclosureVersion: 1 },
	payer: '0x84B5711b5Ff458478A2E55bb4797F5b254517a57',
	recipient: `0x${'55'.repeat(20)}`,
	asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
	amount: '1000000',
	chainId: '11155111',
	settlementContract: `0x${'66'.repeat(20)}`,
	validUntil: '1800000000',
	nonce: `0x${'77'.repeat(32)}`,
	policySecretId: 'CAMPAIGN_POLICY',
}

config.subjectHash = hashSubject(config.subject)
config.quoteId = hashQuote(config)

const makePolicy = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		allowedProductRefHashes: [config.subject.productRefHash],
		maxBid: '1000000',
		campaignId: config.campaignId, publisher: config.subject.publisher, payer: config.payer,
		recipient: config.recipient, asset: config.asset, chainId: config.chainId,
		settlementContract: config.settlementContract, commitmentSalt: `0x${'cc'.repeat(32)}`,
		...overrides,
	})

const makeRuntime = (rawPolicy: string, input: Config = config, now = 1799999999) => {
	const reports: { encodedPayload?: string }[] = []
	const logs: string[] = []
	const requestedSecrets: string[] = []
	const runtime = {
		config: input,
		now: () => new Date(now * 1000),
		getSecret: ({ id }: { id?: string }) => {
			requestedSecrets.push(id ?? '')
			return { result: () => ({ id, value: rawPolicy }) }
		},
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: { encodedPayload?: string }) => {
				reports.push(input)
				return { result: () => ({}) }
			},
		}),
	}
	return {
		runtime: runtime as unknown as TeeRuntime<typeof config>,
		reports,
		logs,
		requestedSecrets,
	}
}

const expectedReport = (eligible: boolean, rawPolicy: string) =>
	hexToBase64(
		encodeAbiParameters(
			parseAbiParameters(
				'uint8 reportKind, uint16 schemaVersion, bytes32 quoteId, bytes32 campaignId, bytes32 subjectHash, address payer, address recipient, address asset, uint256 amount, uint256 chainId, address settlementContract, uint64 validUntil, bytes32 nonce, bool eligible, bytes32 policyCommitment',
			),
			[
				1,
				config.schemaVersion,
				config.quoteId as `0x${string}`,
				config.campaignId as `0x${string}`,
				config.subjectHash as `0x${string}`,
				config.payer as `0x${string}`,
				config.recipient as `0x${string}`,
				config.asset as `0x${string}`,
				BigInt(config.amount),
				BigInt(config.chainId),
				config.settlementContract as `0x${string}`,
				BigInt(config.validUntil),
				config.nonce as `0x${string}`,
				eligible,
				keccak256(stringToHex(rawPolicy)),
			],
		),
	)

describe('confidential placement authorization', () => {
	test('approves an allowed product at the private bid ceiling', () => {
		const rawPolicy = makePolicy()
		const { runtime, reports, requestedSecrets } = makeRuntime(rawPolicy)

		const result = onCronTrigger(runtime)

		expect(result).toContain('eligible=true')
		expect(requestedSecrets).toEqual(['CAMPAIGN_POLICY'])
		expect(reports).toHaveLength(1)
		expect(reports[0].encodedPayload).toBe(expectedReport(true, rawPolicy))
	})

	test('rejects a product outside the private target allowlist', () => {
		const rawPolicy = makePolicy({ allowedProductRefHashes: [`0x${'88'.repeat(32)}`] })
		const { runtime, reports } = makeRuntime(rawPolicy)

		expect(onCronTrigger(runtime)).toContain('eligible=false')
		expect(reports[0].encodedPayload).toBe(expectedReport(false, rawPolicy))
	})

	test('rejects an amount above the private maximum bid', () => {
		const rawPolicy = makePolicy({ maxBid: '999999' })
		const { runtime, reports } = makeRuntime(rawPolicy)

		expect(onCronTrigger(runtime)).toContain('eligible=false')
		expect(reports[0].encodedPayload).toBe(expectedReport(false, rawPolicy))
	})

	test('does not emit a report for malformed private policy data', () => {
		const { runtime, reports } = makeRuntime('{not-json')

		expect(() => onCronTrigger(runtime)).toThrow()
		expect(reports).toHaveLength(0)
	})

	test('does not log or return the private policy values', () => {
		const rawPolicy = makePolicy({ maxBid: '123456789' })
		const { runtime, logs } = makeRuntime(rawPolicy)

		const result = onCronTrigger(runtime)

		expect(logs).toEqual([])
		expect(result).not.toContain(rawPolicy)
		expect(result).not.toContain('123456789')
	})
})

describe('workflow configuration', () => {
	test('matches the Solidity EIP-712 fixture vectors', () => {
		expect(hashSubject(config.subject)).toBe(
			'0x6696182b952e1854487402ac581aa8bcc709f90eaaf4a09c90c16e4a9428143c',
		)
		expect(hashQuote(config)).toBe(
			'0xa786b6216799ecd6d871f3313cde11413d8c3173ff2a8ccdac4bc134ea81173e',
		)
	})

	test('rejects an invalid settlement binding', () => {
		expect(() => configSchema.parse({ ...config, settlementContract: 'not-an-address' })).toThrow()
	})

	test('registers the authorization handler in a Nitro TEE', () => {
		const handlers = initWorkflow(config)

		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCronTrigger)
		expect(handlers[0].requirements).toBeDefined()
	})
})

// These cases assert rejection at the policy and input boundaries, not live CRE enforcement.
describe('quote and policy boundaries', () => {
	for (const key of ['campaignId', 'subjectHash', 'nonce', 'payer', 'recipient', 'asset',
		'amount', 'chainId', 'settlementContract', 'validUntil'] as const) {
		test(`rejects a changed ${key} with an unchanged quote digest`, () => {
			const value = ['amount', 'chainId', 'validUntil'].includes(key)
				? '123' : config[key].replace(/.$/, config[key].endsWith('f') ? 'e' : 'f')
			const { runtime, reports } = makeRuntime(makePolicy(), { ...config, [key]: value })
			expect(() => onCronTrigger(runtime)).toThrow()
			expect(reports).toHaveLength(0)
		})
	}
	test('requires the evaluated product to be part of the subject', () => {
		const input = { ...config, subject: { ...config.subject, productRefHash: `0x${'dd'.repeat(32)}` } }
		const { runtime, reports } = makeRuntime(makePolicy(), input)
		expect(() => onCronTrigger(runtime)).toThrow('Subject binding mismatch')
		expect(reports).toHaveLength(0)
	})
	for (const key of ['campaignId', 'publisher', 'payer', 'recipient', 'asset', 'chainId', 'settlementContract']) {
		test(`declines a private policy for another ${key}`, () => {
			const value = key === 'chainId' ? '1' : `0x${'dd'.repeat(key === 'campaignId' ? 32 : 20)}`
			const { runtime } = makeRuntime(makePolicy({ [key]: value }))
			expect(onCronTrigger(runtime)).toContain('eligible=false')
		})
	}
	test('declines expired quotes, including one second after expiry', () => {
		const { runtime } = makeRuntime(makePolicy(), config, Number(config.validUntil) + 1)
		expect(onCronTrigger(runtime)).toContain('eligible=false')
	})
	test('allows the exact expiry second, matching Solidity', () => {
		const { runtime } = makeRuntime(makePolicy(), config, Number(config.validUntil))
		expect(onCronTrigger(runtime)).toContain('eligible=true')
	})
	test('sanitizes private JSON parse errors', () => {
		const { runtime, reports } = makeRuntime('PRIVATE_UNDISCLOSED_POLICY')
		expect(() => onCronTrigger(runtime)).toThrow('Invalid campaign policy')
		expect(reports).toHaveLength(0)
	})
	test('sanitizes policy validation errors', () => {
		const { runtime } = makeRuntime(makePolicy({ maxBid: 'PRIVATE_INVALID_BID' }))
		try { onCronTrigger(runtime); throw new Error('Expected rejection') }
		catch (error) { expect((error as Error).message).toBe('Invalid campaign policy') }
	})
	test('requires a nonzero commitment salt', () => {
		const { runtime } = makeRuntime(makePolicy({ commitmentSalt: `0x${'00'.repeat(32)}` }))
		expect(() => onCronTrigger(runtime)).toThrow('Invalid campaign policy')
	})
	for (const [key, value] of [
		['amount', '0'], ['amount', '-1'], ['amount', '1.5'], ['amount', (1n << 256n).toString()],
		['chainId', '0'], ['validUntil', (1n << 64n).toString()], ['schemaVersion', 2],
		['recipient', `0x${'00'.repeat(20)}`],
	] as const) {
		test(`rejects invalid ${key}: ${value}`, () => {
			expect(configSchema.safeParse({ ...config, [key]: value }).success).toBe(false)
		})
	}
})
