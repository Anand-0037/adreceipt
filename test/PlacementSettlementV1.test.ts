import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const bytes32 = (label: string) => ethers.keccak256(ethers.toUtf8Bytes(label));
const types = {
  PlacementQuoteV1: [
    { name: "schemaVersion", type: "uint16" },
    { name: "campaignId", type: "bytes32" },
    { name: "subjectHash", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "settlementContract", type: "address" },
  ],
};
const subjectTypes = {
  SubjectV1: [
    { name: "publisher", type: "address" },
    { name: "placementId", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "disclosureVersion", type: "uint16" },
  ],
};

describe("PlacementSettlementV1", function () {
  async function fixture(feeToken = false) {
    const [payer, publisher, recipient, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract(feeToken ? "FeeSettlementToken" : "SettlementToken");
    const settlement = await ethers.deployContract("PlacementSettlementV1", [await token.getAddress()]);
    const amount = ethers.parseUnits("25", 18);
    await token.mint(payer.address, amount * 10n);
    await token.connect(payer).getFunction("approve")(await settlement.getAddress(), amount * 10n);
    const subject = {
      publisher: publisher.address,
      placementId: bytes32("placement-1"),
      productRefHash: bytes32("product-1"),
      contentHash: bytes32("visible-content"),
      disclosureVersion: 1,
    };
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const quote = {
      schemaVersion: 1,
      campaignId: bytes32("campaign-1"),
      subjectHash: await settlement.hashSubject(subject),
      payer: payer.address,
      recipient: recipient.address,
      asset: await token.getAddress(),
      amount,
      validUntil: BigInt((await time.latest()) + 3600),
      nonce: bytes32("nonce-1"),
      chainId,
      settlementContract: await settlement.getAddress(),
    };
    const domain = { name: "AdReceipt", version: "1", chainId, verifyingContract: await settlement.getAddress() };
    const sign = (value = quote) => publisher.signTypedData(domain, types, value);
    return { payer, publisher, recipient, outsider, token, settlement, subject, quote, sign, amount, domain };
  }

  it("matches TypeScript and Solidity subject and quote hashes", async function () {
    const f = await loadFixture(fixture);
    expect(await f.settlement.hashSubject(f.subject)).to.equal(
      ethers.TypedDataEncoder.hashStruct("SubjectV1", subjectTypes, f.subject),
    );
    expect(await f.settlement.hashQuote(f.quote)).to.equal(
      ethers.TypedDataEncoder.hash(f.domain, types, f.quote),
    );
  });

  it("settles the exact payment and emits the frozen receipt", async function () {
    const { payer, publisher, recipient, token, settlement, subject, quote, sign, amount } = await loadFixture(fixture);
    const signature = await sign();
    const receiptId = await settlement.hashQuote(quote);
    const payerBefore = await token.balanceOf(payer.address);
    const recipientBefore = await token.balanceOf(recipient.address);
    await expect(settlement.connect(payer).settlePlacement(subject, quote, signature))
      .to.emit(settlement, "ReceiptCreated")
      .withArgs(receiptId, quote.campaignId, quote.subjectHash, publisher.address, payer.address,
        recipient.address, await token.getAddress(), amount, anyValue, 1);
    expect(await token.balanceOf(payer.address)).to.equal(payerBefore - amount);
    expect(await token.balanceOf(recipient.address)).to.equal(recipientBefore + amount);
    expect(await settlement.consumedQuotes(receiptId)).to.equal(true);
    expect(await settlement.consumedNonces(await settlement.nonceKey(publisher.address, quote.nonce))).to.equal(true);
  });

  it("rejects the wrong payer", async function () {
    const { outsider, settlement, subject, quote, sign } = await loadFixture(fixture);
    await expect(settlement.connect(outsider).settlePlacement(subject, quote, await sign()))
      .to.be.revertedWithCustomError(settlement, "WrongPayer");
  });

  it("rejects the wrong publisher signature", async function () {
    const { payer, outsider, settlement, subject, quote, domain } = await loadFixture(fixture);
    const signature = await outsider.signTypedData(domain, types, quote);
    await expect(settlement.connect(payer).settlePlacement(subject, quote, signature))
      .to.be.revertedWithCustomError(settlement, "InvalidPublisherSignature");
  });

  for (const field of ["recipient", "asset", "amount", "campaignId", "subjectHash", "chainId", "settlementContract", "schemaVersion"] as const) {
    it(`rejects a changed ${field}`, async function () {
      const f = await loadFixture(fixture);
      const changed: any = { ...f.quote };
      if (field === "recipient" || field === "asset" || field === "settlementContract") changed[field] = f.outsider.address;
      else if (field === "amount") changed[field] += 1n;
      else if (field === "chainId" || field === "schemaVersion") changed[field] = BigInt(changed[field]) + 1n;
      else changed[field] = bytes32(`changed-${field}`);
      await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, changed, await f.sign())).to.be.reverted;
    });
  }

  it("rejects an expired quote", async function () {
    const f = await loadFixture(fixture);
    await time.increaseTo(Number(f.quote.validUntil) + 1);
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, await f.sign()))
      .to.be.revertedWithCustomError(f.settlement, "QuoteExpired");
  });

  it("rejects a consumed quote without emitting another receipt", async function () {
    const f = await loadFixture(fixture);
    const signature = await f.sign();
    await f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, signature);
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, signature))
      .to.be.revertedWithCustomError(f.settlement, "QuoteAlreadyConsumed");
  });

  it("rejects a reused publisher-scoped nonce but allows the same subject", async function () {
    const f = await loadFixture(fixture);
    await f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, await f.sign());
    const second = { ...f.quote, campaignId: bytes32("campaign-2") };
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, second, await f.sign(second)))
      .to.be.revertedWithCustomError(f.settlement, "NonceAlreadyConsumed");
    const third = { ...second, nonce: bytes32("nonce-2") };
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, third, await f.sign(third)))
      .to.emit(f.settlement, "ReceiptCreated");
  });

  it("rolls back receipt state when token allowance is missing", async function () {
    const f = await loadFixture(fixture);
    await f.token.connect(f.payer).getFunction("approve")(await f.settlement.getAddress(), 0);
    const receiptId = await f.settlement.hashQuote(f.quote);
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, await f.sign())).to.be.reverted;
    expect(await f.settlement.consumedQuotes(receiptId)).to.equal(false);
  });

  it("rejects fee-on-transfer tokens and emits no receipt", async function () {
    const f = await fixture(true);
    const receiptId = await f.settlement.hashQuote(f.quote);
    await expect(f.settlement.connect(f.payer).settlePlacement(f.subject, f.quote, await f.sign()))
      .to.be.revertedWithCustomError(f.settlement, "NonExactTransfer");
    expect(await f.settlement.consumedQuotes(receiptId)).to.equal(false);
    expect(await f.token.balanceOf(f.recipient.address)).to.equal(0n);
  });

});
