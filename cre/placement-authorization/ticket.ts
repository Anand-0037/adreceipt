import { hashStruct, type Hex } from 'viem'
import { z } from 'zod'

import { address, bytes32, uint } from './quote'

/**
 * PlacementTicketV2, as the confidential handler sees it.
 *
 * This is a deliberate mirror of frontend/lib/ticket.ts, written against viem
 * because the workflow cannot pull in ethers. Two implementations of one
 * encoding is a drift risk, so it is not left to review:
 * shared/vectors/placement-ticket-v2.json pins both runtimes to the same
 * outputs, and both test suites assert against it. Change a type array here
 * without changing it there and the vectors fail on the next run.
 *
 * The handler needs its own copy because it must recompute the commitments
 * itself. Accepting a ticketCommitment supplied in the config would let a
 * caller hand the enclave one ticket and the chain another.
 */

export const TICKET_SCHEMA_VERSION = 2
export const CONTEXT_SCHEMA_VERSION = 2

export const POLICY_PROOF_LEVEL = {
	CRE_SIMULATED: 0,
	CRE_ENFORCED: 1,
} as const

export const CONTEXT_TOPICS = [
	'cloud-hosting', 'developer-tools', 'ecommerce', 'education', 'finance',
	'gaming', 'health', 'travel', 'other',
] as const

export const CONTEXT_INTENTS = [
	'compare', 'learn', 'purchase', 'research', 'troubleshoot', 'other',
] as const

export const CONTEXT_SURFACES = ['chat-answer', 'search-result', 'sidebar', 'summary'] as const

export const sanitizedContextSchema = z.object({
	schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION),
	topic: z.enum(CONTEXT_TOPICS),
	intent: z.enum(CONTEXT_INTENTS),
	// Bounded on purpose. Free text here would eventually carry a raw query.
	locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
	surface: z.enum(CONTEXT_SURFACES),
}).strict()

export type SanitizedContext = z.infer<typeof sanitizedContextSchema>

export const ticketSchema = z.object({
	schemaVersion: z.literal(TICKET_SCHEMA_VERSION),
	ticketNonce: bytes32,
	campaignId: bytes32,
	campaignRevisionHash: bytes32,
	publisher: address,
	contextCommitment: bytes32,
	productRefHash: bytes32,
	contentHash: bytes32,
	policyCommitment: bytes32,
	policyProofLevel: z.union([
		z.literal(POLICY_PROOF_LEVEL.CRE_SIMULATED),
		z.literal(POLICY_PROOF_LEVEL.CRE_ENFORCED),
	]),
	asset: address,
	amount: uint(256).refine((value) => BigInt(value) > 0n, 'Must be positive'),
	validUntil: uint(64),
}).strict()

export type PlacementTicket = z.infer<typeof ticketSchema>

export const sanitizedContextTypes = {
	SanitizedContextV2: [
		{ name: 'schemaVersion', type: 'uint16' },
		{ name: 'topic', type: 'string' },
		{ name: 'intent', type: 'string' },
		{ name: 'locale', type: 'string' },
		{ name: 'surface', type: 'string' },
		{ name: 'salt', type: 'bytes32' },
	],
} as const

export const ticketTypes = {
	PlacementTicketV2: [
		{ name: 'schemaVersion', type: 'uint16' },
		{ name: 'ticketNonce', type: 'bytes32' },
		{ name: 'campaignId', type: 'bytes32' },
		{ name: 'campaignRevisionHash', type: 'bytes32' },
		{ name: 'publisher', type: 'address' },
		{ name: 'contextCommitment', type: 'bytes32' },
		{ name: 'productRefHash', type: 'bytes32' },
		{ name: 'contentHash', type: 'bytes32' },
		{ name: 'policyCommitment', type: 'bytes32' },
		{ name: 'policyProofLevel', type: 'uint8' },
		{ name: 'asset', type: 'address' },
		{ name: 'amount', type: 'uint256' },
		{ name: 'validUntil', type: 'uint64' },
	],
} as const

/**
 * Commit to the sanitized context under a private salt.
 *
 * The salt lives in the campaign policy secret, never in the workflow config,
 * so it stays inside the handler. Without it the commitment covers a few
 * thousand enumerated combinations and anyone could recover the context by
 * enumerating them offline.
 */
export function hashSanitizedContext(context: SanitizedContext, salt: string): Hex {
	const parsed = sanitizedContextSchema.parse(context)
	return hashStruct({
		primaryType: 'SanitizedContextV2',
		types: sanitizedContextTypes,
		data: {
			schemaVersion: parsed.schemaVersion,
			topic: parsed.topic,
			intent: parsed.intent,
			locale: parsed.locale,
			surface: parsed.surface,
			salt: salt as Hex,
		},
	})
}

/** The canonical ticket commitment, which becomes SubjectV1.placementId. */
export function hashTicket(ticket: PlacementTicket): Hex {
	const parsed = ticketSchema.parse(ticket)
	return hashStruct({
		primaryType: 'PlacementTicketV2',
		types: ticketTypes,
		data: {
			schemaVersion: parsed.schemaVersion,
			ticketNonce: parsed.ticketNonce as Hex,
			campaignId: parsed.campaignId as Hex,
			campaignRevisionHash: parsed.campaignRevisionHash as Hex,
			publisher: parsed.publisher as Hex,
			contextCommitment: parsed.contextCommitment as Hex,
			productRefHash: parsed.productRefHash as Hex,
			contentHash: parsed.contentHash as Hex,
			policyCommitment: parsed.policyCommitment as Hex,
			policyProofLevel: parsed.policyProofLevel,
			asset: parsed.asset as Hex,
			amount: BigInt(parsed.amount),
			validUntil: BigInt(parsed.validUntil),
		},
	})
}
