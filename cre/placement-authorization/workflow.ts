import { cre, hexToBase64, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem'
import { z } from 'zod'

import { address, bytes32, configSchema, hashQuote, hashSubject, positiveUint, uint, type Config } from './quote'
export { configSchema } from './quote'

const privatePolicySchema = z.object({
	allowedProductRefHashes: z.array(bytes32).min(1).max(1000),
	maxBid: uint(256),
	campaignId: bytes32,
	publisher: address,
	payer: address,
	recipient: address,
	asset: address,
	chainId: positiveUint,
	settlementContract: address,
	// Generate a random 32-byte value for real policies; do not publish it.
	commitmentSalt: bytes32.refine((value) => !/^0x0{64}$/i.test(value), 'Empty salt'),
}).strict()

const REPORT_PLACEMENT_AUTHORIZATION = 1

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = configSchema.parse(runtime.config)
	if (hashSubject(config.subject).toLowerCase() !== config.subjectHash.toLowerCase()) {
		throw new Error('Subject binding mismatch')
	}
	if (hashQuote(config).toLowerCase() !== config.quoteId.toLowerCase()) {
		throw new Error('Quote binding mismatch')
	}
	const now = Math.floor(runtime.now().getTime() / 1000)
	if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid workflow time')
	const rawPolicy = runtime.getSecret({ id: config.policySecretId }).result().value
	let policy: z.infer<typeof privatePolicySchema>
	try {
		policy = privatePolicySchema.parse(JSON.parse(rawPolicy))
	} catch {
		// Schema errors can contain private values. Keep provider-facing errors fixed.
		throw new Error('Invalid campaign policy')
	}

	const productAllowed = policy.allowedProductRefHashes.some(
		(candidate) => candidate.toLowerCase() === config.subject.productRefHash.toLowerCase(),
	)
	const withinBid = BigInt(config.amount) <= BigInt(policy.maxBid)
	const contextMatches = (['campaignId', 'payer', 'recipient', 'asset', 'chainId',
		'settlementContract'] as const).every((key) => policy[key].toLowerCase() === config[key].toLowerCase())
		&& policy.publisher.toLowerCase() === config.subject.publisher.toLowerCase()
	const unexpired = BigInt(config.validUntil) >= BigInt(now)
	const eligible = productAllowed && withinBid && contextMatches && unexpired
		&& config.payer.toLowerCase() !== config.recipient.toLowerCase()
	const policyCommitment = keccak256(stringToHex(rawPolicy))

	// Every field needed to bind this decision to one PlacementQuoteV1 is in the
	// report. The private allowlist and max bid never cross the TEE boundary.
	const report = encodeAbiParameters(
		parseAbiParameters(
			'uint8 reportKind, uint16 schemaVersion, bytes32 quoteId, bytes32 campaignId, bytes32 subjectHash, address payer, address recipient, address asset, uint256 amount, uint256 chainId, address settlementContract, uint64 validUntil, bytes32 nonce, bool eligible, bytes32 policyCommitment',
		),
		[
			REPORT_PLACEMENT_AUTHORIZATION,
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
			policyCommitment,
		],
	)

	runtime
		.usingTheDons()
		.report({
			encodedPayload: hexToBase64(report),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	return `eligible=${eligible} quoteId=${config.quoteId} policyCommitment=${policyCommitment}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
