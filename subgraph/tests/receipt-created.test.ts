import {
  afterEach,
  assert,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ReceiptCreated } from "../generated/PlacementSettlementV1/PlacementSettlementV1";
import { handleReceiptCreated } from "../src/mapping";

const RECEIPT_ONE = "0x1111111111111111111111111111111111111111111111111111111111111111";
const RECEIPT_TWO = "0x2222222222222222222222222222222222222222222222222222222222222222";
const CAMPAIGN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUBJECT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PUBLISHER = "0x1000000000000000000000000000000000000001";
const PAYER = "0x2000000000000000000000000000000000000002";
const RECIPIENT = "0x3000000000000000000000000000000000000003";
const ASSET = "0x4000000000000000000000000000000000000004";
const SETTLEMENT = "0x5000000000000000000000000000000000000005";
const TRANSACTION = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function bytes32(value: string): Bytes {
  return Bytes.fromHexString(value);
}

function createReceiptEvent(receiptId: string, amount: i64, settledAt: i64): ReceiptCreated {
  const event = changetype<ReceiptCreated>(newMockEvent());
  event.address = Address.fromString(SETTLEMENT);
  event.transaction.hash = bytes32(TRANSACTION);
  event.block.number = BigInt.fromI32(100);
  event.block.timestamp = BigInt.fromI64(settledAt);
  event.logIndex = BigInt.fromI32(receiptId == RECEIPT_ONE ? 0 : 1);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam("receiptId", ethereum.Value.fromFixedBytes(bytes32(receiptId))),
  );
  event.parameters.push(
    new ethereum.EventParam("campaignId", ethereum.Value.fromFixedBytes(bytes32(CAMPAIGN))),
  );
  event.parameters.push(
    new ethereum.EventParam("subjectHash", ethereum.Value.fromFixedBytes(bytes32(SUBJECT))),
  );
  event.parameters.push(
    new ethereum.EventParam("publisher", ethereum.Value.fromAddress(Address.fromString(PUBLISHER))),
  );
  event.parameters.push(
    new ethereum.EventParam("payer", ethereum.Value.fromAddress(Address.fromString(PAYER))),
  );
  event.parameters.push(
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(Address.fromString(RECIPIENT))),
  );
  event.parameters.push(
    new ethereum.EventParam("asset", ethereum.Value.fromAddress(Address.fromString(ASSET))),
  );
  event.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(amount))),
  );
  event.parameters.push(
    new ethereum.EventParam("settledAt", ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(settledAt))),
  );
  event.parameters.push(
    new ethereum.EventParam("schemaVersion", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
  );
  return event;
}

describe("ReceiptCreated", () => {
  afterEach(() => {
    clearStore();
  });

  test("stores immutable settlement evidence with chain context", () => {
    handleReceiptCreated(createReceiptEvent(RECEIPT_ONE, 2500, 1_788_600_000));

    assert.entityCount("Receipt", 1);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "campaignId", CAMPAIGN);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "subjectHash", SUBJECT);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "publisher", PUBLISHER);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "payer", PAYER);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "recipient", RECIPIENT);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "asset", ASSET);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "amount", "2500");
    assert.fieldEquals("Receipt", RECEIPT_ONE, "settlementContract", SETTLEMENT);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "transactionHash", TRANSACTION);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "blockNumber", "100");
    assert.fieldEquals("Receipt", RECEIPT_ONE, "schemaVersion", "1");
  });

  test("keeps separately authorized receipts for the same subject", () => {
    handleReceiptCreated(createReceiptEvent(RECEIPT_ONE, 2500, 1_788_600_000));
    handleReceiptCreated(createReceiptEvent(RECEIPT_TWO, 7500, 1_788_600_100));

    assert.entityCount("Receipt", 2);
    assert.fieldEquals("Receipt", RECEIPT_ONE, "subjectHash", SUBJECT);
    assert.fieldEquals("Receipt", RECEIPT_TWO, "subjectHash", SUBJECT);
    assert.fieldEquals("Receipt", RECEIPT_TWO, "amount", "7500");
  });
});
