import { cre, hexToBase64, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

/**
 * Disclosed - confidential domain verification.
 *
 * An advertiser claims a brand and a domain in AdvertiserRegistry, and the
 * registry issues a per-claim challenge. To prove control, the advertiser
 * publishes that challenge as a DNS TXT record. This workflow resolves the
 * record inside the enclave and emits only a boolean.
 *
 * What the enclave protects: the DNS request and response payloads. Those are
 * the confidential API responses - a node operator never sees which name was
 * queried, what any resolver returned, or how the comparison went. Only the
 * verdict crosses back to the DON.
 *
 * Why DNS-over-HTTPS rather than a resolver socket: the enclave's capability is
 * HTTP, so the lookup is a JSON DoH query. That is a feature rather than a
 * workaround - DoH is authenticated and encrypted end to end, so the answer the
 * enclave scores cannot be tampered with in transit by whoever is running the
 * node.
 */

export const configSchema = z.object({
	schedule: z.string(),
	/** Advertiser whose claim is being checked. */
	advertiser: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	/** Claimed domain, as recorded on-chain. */
	domain: z.string().min(1),
	/** The challenge currently outstanding for this claim, from challengeOf(). */
	challenge: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
	/** Subdomain the TXT record lives on. */
	recordPrefix: z.string().default('_disclosed'),
	/** Prefix inside the TXT value, so unrelated records can be ignored. */
	recordKey: z.string().default('disclosed-verification'),
	/**
	 * DNS-over-HTTPS endpoints. At least two, and they must agree: a single
	 * resolver is a single point of both failure and trust.
	 *
	 * Validated as a non-empty string rather than with `.url()`: zod's URL check
	 * relies on the host's URL constructor, which the workflow's WASM runtime
	 * does not provide, so it rejects every value there.
	 */
	resolvers: z.array(z.string().min(1)).min(2),
})
type Config = z.infer<typeof configSchema>

/** Report kind understood by CREAttestationReceiver.onReport. */
const REPORT_DOMAIN_VERIFICATION = 1

interface ResolverAnswer {
	/** True when the resolver replied at all, including "no such record". */
	answered: boolean
	records: string[]
}

/**
 * Parse a DoH JSON response.
 *
 * Status 0 is NOERROR and status 3 is NXDOMAIN. Both are answers: NXDOMAIN says
 * the record is genuinely absent, which is a real verdict. Anything else means
 * we learned nothing, and must not be reported as a negative.
 */
const parseDohResponse = (body: string): ResolverAnswer => {
	let parsed: { Status?: number; Answer?: { type?: number; data?: string }[] }
	try {
		parsed = JSON.parse(body)
	} catch {
		return { answered: false, records: [] }
	}

	const status = parsed.Status ?? -1
	if (status !== 0 && status !== 3) {
		return { answered: false, records: [] }
	}

	const records = (parsed.Answer ?? [])
		.filter((a) => a.type === 16)
		// TXT values arrive quoted, and a long value is split into chunks.
		.map((a) => (a.data ?? '').replace(/"/g, '').trim())
		.filter((r) => r.length > 0)

	return { answered: true, records }
}

// ─── Confidential handler ───────────────────────────────────
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config
	const recordName = `${config.recordPrefix}.${config.domain.toLowerCase()}`
	const expected = `${config.recordKey}=${config.challenge}`

	const http = new cre.capabilities.HTTPClient()

	// ── Query every resolver from inside the enclave ──
	// Request and response payloads stay confidential from node operators.
	const answers: ResolverAnswer[] = config.resolvers.map((endpoint) => {
		const url = `${endpoint}?name=${encodeURIComponent(recordName)}&type=TXT`
		const response = http
			.sendRequest(runtime, {
				url,
				method: 'GET',
				multiHeaders: { Accept: { values: ['application/dns-json'] } },
			})
			.result()

		if (!ok(response)) {
			// Unreachable, not a negative answer.
			return { answered: false, records: [] }
		}
		return parseDohResponse(text(response))
	})

	// ── Decision logic over the confidential payloads ──
	// Deterministic for a given input: the enclave result is attested and
	// verified by DON consensus, so nothing here may read a clock or a random
	// source. That is also why checkedAt is not sampled locally, below.
	const answered = answers.filter((a) => a.answered)
	const agreed =
		answered.length === 0
			? []
			: answered[0].records.filter((record) => answered.every((a) => a.records.includes(record)))

	const conclusive = answered.length >= 2
	const verified = conclusive && agreed.some((record) => record === expected)

	// ⚠️ Simulation only. Remove before deploying - logs escape the enclave's
	// confidentiality guarantee, and this one is deliberately just a verdict.
	runtime.log(
		`domain check complete: resolvers_answered=${answered.length} conclusive=${conclusive} verified=${verified}`,
	)

	if (!conclusive) {
		// Refuse to report rather than report `false`. Too few resolvers answered,
		// so we established nothing - and a false verdict would revoke a
		// legitimate advertiser because our network had a bad minute.
		throw new Error('Inconclusive: fewer than two resolvers answered. Nothing reported.')
	}

	// ── Cross back to the DON ──
	// Only the verdict goes over. Never a raw DNS answer.
	const donRuntime = runtime.usingTheDons()

	// Matches CREAttestationReceiver.encodeDomainReport exactly:
	//   abi.encode(uint8 kind, abi.encode(address, bool, bytes32, uint64))
	//
	// checkedAt is 0 on purpose. Every DON node must produce a byte-identical
	// result for consensus to pass, so the enclave cannot sample a local clock.
	// The authoritative time is the block timestamp of the delivering
	// transaction, which the chain records anyway.
	const payload = encodeAbiParameters(
		parseAbiParameters('address advertiser, bool verified, bytes32 challenge, uint64 checkedAt'),
		[config.advertiser as `0x${string}`, verified, config.challenge as `0x${string}`, 0n],
	)

	const report = encodeAbiParameters(parseAbiParameters('uint8 kind, bytes payload'), [
		REPORT_DOMAIN_VERIFICATION,
		payload,
	])

	donRuntime
		.report({
			encodedPayload: hexToBase64(report),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	return `verified=${verified} (resolvers answered: ${answered.length}/${config.resolvers.length})`
}

// ─── Workflow init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
