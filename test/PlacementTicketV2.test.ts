import { expect } from "chai";
import { type HDNodeWallet, TypedDataEncoder, Wallet } from "ethers";
import vectors from "../shared/vectors/placement-ticket-v2.json";
import { QUOTE_TYPES, SUBJECT_TYPES, domain } from "../frontend/lib/quote";
import type { PlacementQuoteV1, SignedQuote } from "../frontend/lib/quote";
import {
  POLICY_PROOF_LEVEL,
  hashSanitizedContext,
  hashTicket,
  parseSanitizedContext,
  parseTicket,
  subjectFromTicket,
} from "../frontend/lib/ticket";
import type { PlacementTicketV2, SanitizedContextV2 } from "../frontend/lib/ticket";
import { buildPreflight, serialisePreflight } from "../frontend/lib/preflight";
import type { AuthorizationResult } from "../frontend/lib/preflight";

const context = { ...vectors.context, salt: vectors.contextSalt } as SanitizedContextV2;
const ticket = vectors.ticket as PlacementTicketV2;

/** A ticket, subject and signed quote that all agree, signed by `publisher`. */
async function signedPacket(publisher: HDNodeWallet, overrides: Partial<PlacementTicketV2> = {}) {
  const built: PlacementTicketV2 = { ...ticket, publisher: publisher.address, ...overrides };
  const subject = subjectFromTicket(built);
  const subjectHash = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);
  const quote: PlacementQuoteV1 = {
    ...(vectors.quote as PlacementQuoteV1),
    subjectHash,
    campaignId: built.campaignId,
    asset: built.asset,
    amount: built.amount,
    // The ticket keeps every integer as a string; PlacementQuoteV1 predates it.
    validUntil: Number(built.validUntil),
  };
  const signature = await publisher.signTypedData(
    domain(quote.chainId),
    QUOTE_TYPES as never,
    quote,
  );
  const receiptId = TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote);
  const signed: SignedQuote = { subject, quote, signature, receiptId };
  return { ticket: built, signed, subjectHash, receiptId };
}

function authorization(
  built: PlacementTicketV2,
  subjectHash: string,
  receiptId: string,
  overrides: Partial<AuthorizationResult> = {},
): AuthorizationResult {
  return {
    eligible: true,
    ticketCommitment: hashTicket(built),
    quoteId: receiptId,
    campaignId: built.campaignId,
    campaignRevisionHash: built.campaignRevisionHash,
    subjectHash,
    contextCommitment: built.contextCommitment,
    policyCommitment: built.policyCommitment,
    policyProofLevel: POLICY_PROOF_LEVEL.CRE_SIMULATED,
    ...overrides,
  };
}

describe("PlacementTicketV2 canonical encoding", function () {
  it("reproduces the committed cross-runtime vectors", function () {
    // The confidential handler asserts these same four values from its own
    // viem implementation. If either encoding changes, one suite fails.
    expect(hashSanitizedContext(context)).to.equal(vectors.expected.contextCommitment);
    expect(hashTicket(ticket)).to.equal(vectors.expected.ticketCommitment);

    const subject = subjectFromTicket(ticket);
    expect(TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject)).to.equal(
      vectors.expected.subjectHash,
    );
    expect(
      TypedDataEncoder.hash(
        domain(vectors.quote.chainId),
        QUOTE_TYPES as never,
        vectors.quote as PlacementQuoteV1,
      ),
    ).to.equal(vectors.expected.receiptId);
  });

  it("carries the ticket commitment through as SubjectV1.placementId", function () {
    // This is what lets V2 ride the unchanged V1 pipeline.
    expect(subjectFromTicket(ticket).placementId).to.equal(hashTicket(ticket));
  });

  it("copies productRefHash and contentHash from the ticket, not from a caller", function () {
    const subject = subjectFromTicket(ticket);
    expect(subject.productRefHash).to.equal(ticket.productRefHash);
    expect(subject.contentHash).to.equal(ticket.contentHash);
    expect(subject.disclosureVersion).to.equal(1);
  });

  it("changes the commitment when any single field changes", function () {
    const baseline = hashTicket(ticket);
    const mutations: Partial<PlacementTicketV2>[] = [
      { ticketNonce: `0x${"12".repeat(32)}` },
      { campaignId: `0x${"23".repeat(32)}` },
      { campaignRevisionHash: `0x${"34".repeat(32)}` },
      { publisher: "0x8888888888888888888888888888888888888888" },
      { contextCommitment: `0x${"45".repeat(32)}` },
      { productRefHash: `0x${"56".repeat(32)}` },
      { contentHash: `0x${"67".repeat(32)}` },
      { policyCommitment: `0x${"78".repeat(32)}` },
      { policyProofLevel: POLICY_PROOF_LEVEL.CRE_ENFORCED },
      { asset: "0x1111111111111111111111111111111111111111" },
      { amount: "1000001" },
      { validUntil: "1800000001" },
    ];

    const seen = new Set<string>([baseline]);
    for (const mutation of mutations) {
      const changed = hashTicket({ ...ticket, ...mutation });
      const field = Object.keys(mutation)[0];
      expect(changed, `${field} did not change the commitment`).to.not.equal(baseline);
      // Also distinct from every other mutation, which rules out two fields
      // collapsing into the same encoded position.
      expect(seen.has(changed), `${field} collided with another field`).to.equal(false);
      seen.add(changed);
    }
  });

  it("stops a changed ticket verifying against the original subject", function () {
    const original = subjectFromTicket(ticket);
    const tampered = { ...ticket, amount: "9000000" };
    expect(hashTicket(tampered)).to.not.equal(original.placementId);
    // And the whole chain moves with it, up to the receipt id.
    const movedSubject = subjectFromTicket(tampered);
    expect(
      TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, movedSubject),
    ).to.not.equal(vectors.expected.subjectHash);
  });

  it("rejects a malformed ticket rather than hashing it", function () {
    expect(() => parseTicket({ ...ticket, schemaVersion: 1 })).to.throw("schemaVersion must be 2");
    expect(() => parseTicket({ ...ticket, amount: "0" })).to.throw("greater than zero");
    expect(() => parseTicket({ ...ticket, amount: "-1" })).to.throw("base-10 integer");
    expect(() => parseTicket({ ...ticket, amount: "1.5" })).to.throw("base-10 integer");
    expect(() => parseTicket({ ...ticket, policyProofLevel: 2 as never })).to.throw(
      "policyProofLevel must be",
    );
    expect(() => parseTicket({ ...ticket, publisher: `0x${"00".repeat(20)}` })).to.throw(
      "zero address",
    );
    expect(() => parseTicket({ ...ticket, contentHash: "0xdeadbeef" })).to.throw("32 bytes");
    expect(() => parseTicket({ ...ticket, validUntil: "0" })).to.throw("must be positive");
    expect(() => parseTicket({ ...ticket, validUntil: 1800000000 })).to.throw("integer string");
    expect(() => parseTicket({ ...ticket, extra: 1 } as never)).to.throw("Unexpected ticket field");
  });
});

describe("sanitized context commitments", function () {
  it("needs the salt to be worth publishing", function () {
    // Without a salt the commitment covers a few thousand enumerated
    // combinations, so a different salt must give a different commitment.
    const other = hashSanitizedContext({ ...context, salt: `0x${"ab".repeat(32)}` });
    expect(other).to.not.equal(vectors.expected.contextCommitment);
    expect(() => parseSanitizedContext({ ...context, salt: `0x${"00".repeat(32)}` })).to.throw(
      "must not be zero",
    );
  });

  it("refuses anything outside the closed vocabulary", function () {
    expect(() => parseSanitizedContext({ ...context, topic: "raw-query" })).to.throw(
      "Unknown context topic",
    );
    expect(() => parseSanitizedContext({ ...context, intent: "anything" })).to.throw(
      "Unknown context intent",
    );
    expect(() => parseSanitizedContext({ ...context, surface: "banner" })).to.throw(
      "Unknown context surface",
    );
    expect(() => parseSanitizedContext({ ...context, locale: "english" })).to.throw("locale");
  });

  it("cannot be handed a raw query under any field", function () {
    // The failure this guards against is a caller reaching for the shortest
    // path and committing to the user's actual words.
    const query = "what is the cheapest managed postgres for a side project";
    expect(() => parseSanitizedContext({ ...context, topic: query })).to.throw();
    expect(() => parseSanitizedContext({ ...context, query } as never)).to.throw(
      "Unexpected context field: query",
    );
    expect(() => parseSanitizedContext({ ...context, rawQuery: query } as never)).to.throw(
      "Unexpected context field: rawQuery",
    );
  });

  it("distinguishes contexts that differ only in one enumerated field", function () {
    const commitments = new Set(
      (["compare", "learn", "purchase", "research", "troubleshoot", "other"] as const).map(
        (intent) => hashSanitizedContext({ ...context, intent }),
      ),
    );
    expect(commitments.size).to.equal(6);
  });
});

describe("settlement preflight", function () {
  let publisher: HDNodeWallet;

  beforeEach(function () {
    publisher = Wallet.createRandom();
  });

  it("builds a complete, reviewable packet for an eligible ticket", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const packet = buildPreflight({
      authorization: authorization(built, subjectHash, receiptId),
      ticket: built,
      signed,
      now: Number(built.validUntil) - 600,
    });

    expect(packet.proofLevel).to.equal("CRE_SIMULATED");
    expect(packet.broadcast).to.equal(false);
    expect(packet.receiptId).to.equal(receiptId);
    expect(packet.ticketCommitment).to.equal(hashTicket(built));
    expect(packet.hashes.subjectHash).to.equal(subjectHash);
    expect(packet.publisherSignature).to.equal(signed.signature);
    expect(packet.expiry.secondsRemaining).to.equal(600);
    // The approval a payer must grant is the exact price, never unlimited.
    expect(packet.payment.allowanceRequired).to.equal(built.amount);
    expect(packet.payment.chainId).to.equal(signed.quote.chainId);
    expect(packet.payment.settlementContract).to.equal(signed.quote.settlementContract);
    expect(packet.nonce).to.equal(signed.quote.nonce);
  });

  it("is deterministic, so two reviewers can diff their packets", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const args = {
      authorization: authorization(built, subjectHash, receiptId),
      ticket: built,
      signed,
      now: Number(built.validUntil) - 600,
    };
    expect(serialisePreflight(buildPreflight(args))).to.equal(
      serialisePreflight(buildPreflight(args)),
    );
  });

  it("refuses to prepare anything from an ineligible authorization", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    expect(() =>
      buildPreflight({
        authorization: authorization(built, subjectHash, receiptId, { eligible: false }),
        ticket: built,
        signed,
        now: Number(built.validUntil) - 600,
      }),
    ).to.throw("declined this placement");
  });

  it("refuses an authorization issued for a different ticket", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const elsewhere = hashTicket({ ...built, ticketNonce: `0x${"99".repeat(32)}` });
    expect(() =>
      buildPreflight({
        authorization: authorization(built, subjectHash, receiptId, {
          ticketCommitment: elsewhere,
        }),
        ticket: built,
        signed,
        now: Number(built.validUntil) - 600,
      }),
    ).to.throw("different placement ticket");
  });

  it("refuses a decision about a different quote, campaign or revision", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const base = { ticket: built, signed, now: Number(built.validUntil) - 600 };

    expect(() =>
      buildPreflight({
        ...base,
        authorization: authorization(built, subjectHash, receiptId, {
          quoteId: `0x${"01".repeat(32)}`,
        }),
      }),
    ).to.throw("different quote");

    expect(() =>
      buildPreflight({
        ...base,
        authorization: authorization(built, subjectHash, receiptId, {
          campaignRevisionHash: `0x${"02".repeat(32)}`,
        }),
      }),
    ).to.throw("different campaign revision");

    expect(() =>
      buildPreflight({
        ...base,
        authorization: authorization(built, subjectHash, receiptId, {
          contextCommitment: `0x${"03".repeat(32)}`,
        }),
      }),
    ).to.throw("different context commitment");

    expect(() =>
      buildPreflight({
        ...base,
        authorization: authorization(built, subjectHash, receiptId, {
          policyCommitment: `0x${"04".repeat(32)}`,
        }),
      }),
    ).to.throw("different policy commitment");
  });

  it("refuses a CRE_ENFORCED claim, which nothing here can produce", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    expect(() =>
      buildPreflight({
        authorization: authorization(built, subjectHash, receiptId, {
          policyProofLevel: POLICY_PROOF_LEVEL.CRE_ENFORCED,
        }),
        ticket: built,
        signed,
        now: Number(built.validUntil) - 600,
      }),
    ).to.throw("Deployment access is not enabled");
  });

  it("refuses a subject whose placementId is not the ticket commitment", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const tampered = {
      ...signed,
      subject: { ...signed.subject, placementId: `0x${"05".repeat(32)}` },
    };
    expect(() =>
      buildPreflight({
        authorization: authorization(built, subjectHash, receiptId),
        ticket: built,
        signed: tampered,
        now: Number(built.validUntil) - 600,
      }),
    ).to.throw("not this ticket's commitment");
  });

  it("refuses a signature from anyone but the named publisher", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const impostor = Wallet.createRandom();
    const forged = {
      ...signed,
      signature: await impostor.signTypedData(
        domain(signed.quote.chainId),
        QUOTE_TYPES as never,
        signed.quote,
      ),
    };
    expect(() =>
      buildPreflight({
        authorization: authorization(built, subjectHash, receiptId),
        ticket: built,
        signed: forged,
        now: Number(built.validUntil) - 600,
      }),
    ).to.throw("does not belong to the named publisher");
  });

  it("refuses an expired quote at the exact second it lapses", async function () {
    const { ticket: built, signed, subjectHash, receiptId } = await signedPacket(publisher);
    const args = {
      authorization: authorization(built, subjectHash, receiptId),
      ticket: built,
      signed,
    };
    const expiry = Number(built.validUntil);
    expect(buildPreflight({ ...args, now: expiry - 1 }).expiry.secondsRemaining).to.equal(1);
    expect(() => buildPreflight({ ...args, now: expiry })).to.throw("has expired");
  });
});
