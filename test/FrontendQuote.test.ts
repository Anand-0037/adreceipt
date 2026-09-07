import { expect } from "chai";
import { TypedDataEncoder, Wallet } from "ethers";
import {
  QUOTE_TYPES,
  buildQuote,
  buildSubject,
  domain,
  parseSignedQuote,
  type SignedQuote,
} from "../frontend/lib/quote";

async function signedPacket(): Promise<SignedQuote> {
  const publisher = Wallet.createRandom();
  const payer = Wallet.createRandom();
  const subject = buildSubject({
    publisher: publisher.address,
    placementLabel: "answer-7",
    productRef: "sku-42",
    recommendationText: "A recommendation with exact whitespace.\n",
  });
  const quote = buildQuote({
    subject,
    campaignLabel: "campaign-1",
    payer: payer.address,
    recipient: publisher.address,
    amountUsdc: "0.1",
    chainId: 11155111,
    validForSeconds: 600,
  });
  const signature = await publisher.signTypedData(
    domain(quote.chainId),
    QUOTE_TYPES as never,
    quote,
  );
  return {
    subject,
    quote,
    signature,
    receiptId: TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote),
  };
}

describe("browser quote validation", function () {
  it("accepts a fully bound publisher authorization", async function () {
    const signed = await signedPacket();
    expect(parseSignedQuote(JSON.stringify(signed))).to.deep.equal(signed);
  });

  it("rejects content changes before ERC-20 approval", async function () {
    const signed = await signedPacket();
    signed.subject.contentHash = buildSubject({
      publisher: signed.subject.publisher,
      placementLabel: "answer-7",
      productRef: "sku-42",
      recommendationText: "A recommendation with exact whitespace.",
    }).contentHash;
    expect(() => parseSignedQuote(JSON.stringify(signed))).to.throw(
      "recommendation subject does not match",
    );
  });

  it("rejects a forged receipt id and an expired quote", async function () {
    const forged = await signedPacket();
    forged.receiptId = `0x${"11".repeat(32)}`;
    expect(() => parseSignedQuote(JSON.stringify(forged))).to.throw("receipt ID does not match");

    const expired = await signedPacket();
    expired.quote.validUntil = 1;
    expect(() => parseSignedQuote(JSON.stringify(expired))).to.throw("quote has expired");
  });
});
