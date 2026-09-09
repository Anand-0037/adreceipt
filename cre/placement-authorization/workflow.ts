import { cre, hexToBase64, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem'
import { z } from 'zod'

import { address, bytes32, configSchema as quoteConfigSchema, hashQuote, hashSubject, positiveUint, uint } from './quote'
import {
	CONTEXT_INTENTS, CONTEXT_TOPICS, POLICY_PROOF_LEVEL, hashSanitizedContext, hashTicket,
	sanitizedContextSchema, ticketSchema,
} from './ticket'

/**
 * The workflow now authorises a PlacementTicketV2, not a bare quote.
 *
 * V1 checked that a quote was internally consistent and priced within a private
 * ceiling. It could not check *what* the placement was for: the campaign
 * revision, the context it would appear in, and the policy that authorised it
 * were all outside the signed structure, so any of them could change after
 * authorisation without invalidating anything.
 *
 * V2 binds all three into one commitment that becomes SubjectV1.placementId, so
 * the enclave can verify the entire chain from ticket to receipt id, and the
 * private policy can decide on the sanitized context rather than on price
 * alone. No contract ABI changes: placementId was already a bytes32.
 */

const privatePolicySchema = z.object({
	allowedProductRefHashes: z.array(bytes32).min(1).max(1000),
	maxBid: uint(256),
	campaignId: bytes32,
	// Pins the exact campaign revision this policy authorises. A ticket built
	// against a superseded revision is declined rather than silently honoured.
	campaignRevisionHash: bytes32,
	allowedTopics: z.array(z.enum(CONTEXT_TOPICS)).min(1),
	allowedIntents: z.array(z.enum(CONTEXT_INTENTS)).min(1),
	publisher: address,
	payer: address,
	recipient: address,
	asset: address,
	chainId: positiveUint,
	settlementContract: address,
	// Generate a random 32-byte value for real policies; do not publish it.
	commitmentSalt: bytes32.refine((value) => !/^0x0{64}$/i.test(value), 'Empty salt'),
	// Separate salt for the context commitment, so opening one never opens the
	// other. Also never published.
	contextSalt: bytes32.refine((value) => !/^0x0{64}$/i.test(value), 'Empty salt'),
}).strict()

export const configSchema = quoteConfigSchema.extend({
	ticket: ticketSchema,
	context: sanitizedContextSchema,
})
export type Config = z.infer<typeof configSchema>

const REPORT_PLACEMENT_AUTHORIZATION = 1

const REPORT_PARAMS =
	'uint8 reportKind, uint16 schemaVersion, bytes32 ticketCommitment, bytes32 quoteId, bytes32 campaignId, bytes32 campaignRevisionHash, bytes32 subjectHash, bytes32 contextCommitment, address payer, address recipient, address asset, uint256 amount, uint256 chainId, address settlementContract, uint64 validUntil, bytes32 nonce, bool eligible, uint8 policyProofLevel, bytes32 policyCommitment'

const lower = (value: string) => value.toLowerCase()

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = configSchema.parse(runtime.config)

	// ── Structural binding ────────────────────────────────────────────────
	// These are malformed inputs, not policy decisions, so they throw and emit
	// no report. Reporting `eligible=false` for them would blur a caller bug
	// into a genuine campaign refusal.
	const ticketCommitment = hashTicket(config.ticket)
	if (lower(ticketCommitment) !== lower(config.subject.placementId)) {
		throw new Error('Ticket binding mismatch')
	}
	// placementId only covers the ticket. The subject carries its own copies of
	// these fields, so a subject could still name one product while its ticket
	// committed to another.
	if (lower(config.ticket.publisher) !== lower(config.subject.publisher)
		|| lower(config.ticket.productRefHash) !== lower(config.subject.productRefHash)
		|| lower(config.ticket.contentHash) !== lower(config.subject.contentHash)) {
		throw new Error('Ticket subject mismatch')
	}
	if (lower(config.ticket.asset) !== lower(config.asset)
		|| BigInt(config.ticket.amount) !== BigInt(config.amount)
		|| BigInt(config.ticket.validUntil) !== BigInt(config.validUntil)
		|| lower(config.ticket.campaignId) !== lower(config.campaignId)) {
		throw new Error('Ticket quote mismatch')
	}
	if (hashSubject(config.subject).toLowerCase() !== config.subjectHash.toLowerCase()) {
		throw new Error('Subject binding mismatch')
	}
	if (hashQuote(config).toLowerCase() !== config.quoteId.toLowerCase()) {
		throw new Error('Quote binding mismatch')
	}
	// Nothing here can produce a live DON attestation, so a ticket claiming to
	// have one is refused outright rather than reported on. Removing this check
	// is the only way to emit CRE_ENFORCED, which makes the claim auditable.
	if (config.ticket.policyProofLevel !== POLICY_PROOF_LEVEL.CRE_SIMULATED) {
		throw new Error('Unsupported policy proof level')
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

	// ── Private policy decision ───────────────────────────────────────────
	// Everything below is a refusal the campaign owner is entitled to make, so
	// it reports `eligible=false` rather than throwing. The inputs to these
	// comparisons stay inside the handler; only the boolean leaves it.
	const productAllowed = policy.allowedProductRefHashes.some(
		(candidate) => lower(candidate) === lower(config.subject.productRefHash),
	)
	const withinBid = BigInt(config.amount) <= BigInt(policy.maxBid)
	const contextMatches = (['campaignId', 'payer', 'recipient', 'asset', 'chainId',
		'settlementContract'] as const).every((key) => lower(policy[key]) === lower(config[key]))
		&& lower(policy.publisher) === lower(config.subject.publisher)
	const unexpired = BigInt(config.validUntil) >= BigInt(now)

	// The sanitized context is recomputed here rather than trusted: the salt is
	// private, so only the handler can confirm that the published commitment is
	// a commitment to *this* context.
	const contextBound =
		lower(hashSanitizedContext(config.context, policy.contextSalt))
		=== lower(config.ticket.contextCommitment)
	const topicAllowed = policy.allowedTopics.includes(config.context.topic)
	const intentAllowed = policy.allowedIntents.includes(config.context.intent)
	const revisionBound = lower(policy.campaignRevisionHash) === lower(config.ticket.campaignRevisionHash)

	// Salted, so a commitment over a small policy space cannot be brute-forced
	// back to the allowlist and bid ceiling it commits to.
	const policyCommitment = keccak256(
		encodeAbiParameters(parseAbiParameters('bytes32 policyHash, bytes32 salt'), [
			keccak256(stringToHex(rawPolicy)),
			policy.commitmentSalt as `0x${string}`,
		]),
	)
	// Binds the ticket to this exact private policy. The advertiser publishes
	// the commitment when the ticket is built and keeps the policy itself.
	const policyBound = lower(policyCommitment) === lower(config.ticket.policyCommitment)

	const eligible = productAllowed && withinBid && contextMatches && unexpired
		&& contextBound && topicAllowed && intentAllowed && revisionBound && policyBound
		&& lower(config.payer) !== lower(config.recipient)

	// Every field needed to bind this decision to one PlacementTicketV2 and the
	// PlacementQuoteV1 it authorises. The allowlist, bid ceiling, allowed topics
	// and both salts never cross the TEE boundary.
	const report = encodeAbiParameters(parseAbiParameters(REPORT_PARAMS), [
		REPORT_PLACEMENT_AUTHORIZATION,
		config.schemaVersion,
		ticketCommitment,
		config.quoteId as `0x${string}`,
		config.campaignId as `0x${string}`,
		config.ticket.campaignRevisionHash as `0x${string}`,
		config.subjectHash as `0x${string}`,
		config.ticket.contextCommitment as `0x${string}`,
		config.payer as `0x${string}`,
		config.recipient as `0x${string}`,
		config.asset as `0x${string}`,
		BigInt(config.amount),
		BigInt(config.chainId),
		config.settlementContract as `0x${string}`,
		BigInt(config.validUntil),
		config.nonce as `0x${string}`,
		eligible,
		config.ticket.policyProofLevel,
		policyCommitment,
	])

	runtime
		.usingTheDons()
		.report({
			encodedPayload: hexToBase64(report),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	return `eligible=${eligible} ticketCommitment=${ticketCommitment} quoteId=${config.quoteId} policyCommitment=${policyCommitment}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
