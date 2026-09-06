import { hashStruct, hashTypedData, type Hex } from 'viem'
import { z } from 'zod'

export const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
	.refine((value) => !/^0x0{40}$/i.test(value), 'Zero address')
export const uint = (bits: number) => z.string().max(78).regex(/^(0|[1-9][0-9]*)$/)
	.refine((value) => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78 && BigInt(value) < (1n << BigInt(bits)), `Exceeds uint${bits}`)
export const positiveUint = uint(256).refine((value) => /^[1-9][0-9]*$/.test(value) && value.length <= 78, 'Must be positive')

export const subjectSchema = z.object({
	publisher: address,
	placementId: bytes32,
	productRefHash: bytes32,
	contentHash: bytes32,
	disclosureVersion: z.literal(1),
}).strict()

export const subjectTypes = {
	SubjectV1: [
		{ name: 'publisher', type: 'address' },
		{ name: 'placementId', type: 'bytes32' },
		{ name: 'productRefHash', type: 'bytes32' },
		{ name: 'contentHash', type: 'bytes32' },
		{ name: 'disclosureVersion', type: 'uint16' },
	],
} as const
export const quoteTypes = {
	PlacementQuoteV1: [
		{ name: 'schemaVersion', type: 'uint16' },
		{ name: 'campaignId', type: 'bytes32' },
		{ name: 'subjectHash', type: 'bytes32' },
		{ name: 'payer', type: 'address' },
		{ name: 'recipient', type: 'address' },
		{ name: 'asset', type: 'address' },
		{ name: 'amount', type: 'uint256' },
		{ name: 'validUntil', type: 'uint64' },
		{ name: 'nonce', type: 'bytes32' },
		{ name: 'chainId', type: 'uint256' },
		{ name: 'settlementContract', type: 'address' },
	],
} as const

export const configSchema = z.object({
	schedule: z.string().min(1),
	schemaVersion: z.literal(1),
	quoteId: bytes32,
	campaignId: bytes32,
	subjectHash: bytes32,
	subject: subjectSchema,
	payer: address,
	recipient: address,
	asset: address,
	amount: positiveUint,
	chainId: positiveUint,
	settlementContract: address,
	validUntil: uint(64),
	nonce: bytes32,
	policySecretId: z.string().min(1),
}).strict()
export type Config = z.infer<typeof configSchema>

export function hashSubject(subject: z.infer<typeof subjectSchema>) {
	return hashStruct({ primaryType: 'SubjectV1', types: subjectTypes, data: {
		publisher: subject.publisher as Hex, placementId: subject.placementId as Hex,
		productRefHash: subject.productRefHash as Hex, contentHash: subject.contentHash as Hex,
		disclosureVersion: subject.disclosureVersion,
	} })
}
export function hashQuote(config: Config) {
	return hashTypedData({
		domain: { name: 'AdReceipt', version: '1', chainId: BigInt(config.chainId),
			verifyingContract: config.settlementContract as Hex },
		primaryType: 'PlacementQuoteV1', types: quoteTypes,
		message: {
			schemaVersion: config.schemaVersion, campaignId: config.campaignId as Hex,
			subjectHash: config.subjectHash as Hex, payer: config.payer as Hex,
			recipient: config.recipient as Hex, asset: config.asset as Hex,
			amount: BigInt(config.amount), validUntil: BigInt(config.validUntil),
			nonce: config.nonce as Hex, chainId: BigInt(config.chainId),
			settlementContract: config.settlementContract as Hex,
		},
	})
}
