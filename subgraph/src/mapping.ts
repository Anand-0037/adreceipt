import { BigInt } from "@graphprotocol/graph-ts";
import { ReceiptCreated } from "../generated/PlacementSettlementV1/PlacementSettlementV1";
import { CampaignSummary, Receipt } from "../generated/schema";

const ONE = BigInt.fromI32(1);

export function handleReceiptCreated(event: ReceiptCreated): void {
  const receipt = new Receipt(event.params.receiptId);
  receipt.campaignId = event.params.campaignId;
  receipt.subjectHash = event.params.subjectHash;
  receipt.publisher = event.params.publisher;
  receipt.payer = event.params.payer;
  receipt.recipient = event.params.recipient;
  receipt.asset = event.params.asset;
  receipt.amount = event.params.amount;
  receipt.settledAt = event.params.settledAt;
  receipt.schemaVersion = event.params.schemaVersion;
  receipt.settlementContract = event.address;
  receipt.transactionHash = event.transaction.hash;
  receipt.logIndex = event.logIndex;
  receipt.blockNumber = event.block.number;
  receipt.blockTimestamp = event.block.timestamp;
  receipt.save();

  let campaign = CampaignSummary.load(event.params.campaignId);
  if (campaign == null) {
    campaign = new CampaignSummary(event.params.campaignId);
    campaign.receiptCount = BigInt.zero();
    campaign.totalPaid = BigInt.zero();
    campaign.firstSettledAt = event.params.settledAt;
  }

  campaign.receiptCount = campaign.receiptCount.plus(ONE);
  campaign.totalPaid = campaign.totalPaid.plus(event.params.amount);
  campaign.lastSettledAt = event.params.settledAt;
  campaign.save();
}
