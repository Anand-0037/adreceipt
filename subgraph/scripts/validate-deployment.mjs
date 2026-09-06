import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXPECTED_RECEIPT_CREATED_INPUTS = [
  ["receiptId", "bytes32", true],
  ["campaignId", "bytes32", true],
  ["subjectHash", "bytes32", true],
  ["publisher", "address", false],
  ["payer", "address", false],
  ["recipient", "address", false],
  ["asset", "address", false],
  ["amount", "uint256", false],
  ["settledAt", "uint64", false],
  ["schemaVersion", "uint16", false],
];

export function validateManifest(manifest) {
  const address = manifest.match(/^\s*address:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  const startBlockText = manifest.match(/^\s*startBlock:\s*(\d+)\s*$/m)?.[1];

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("subgraph.yaml must contain a valid settlement contract address");
  }

  if (address.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("replace the zero-address build sentinel before deployment");
  }

  const startBlock = Number(startBlockText);
  if (!Number.isSafeInteger(startBlock) || startBlock <= 0) {
    throw new Error("subgraph.yaml must contain the settlement deployment block");
  }

  return { address, startBlock };
}

export function validateReceiptAbi(abi) {
  if (!Array.isArray(abi)) {
    throw new Error("PlacementSettlementV1 ABI must be a JSON array");
  }

  const events = abi.filter((entry) => entry?.type === "event" && entry.name === "ReceiptCreated");
  if (events.length !== 1) {
    throw new Error("PlacementSettlementV1 ABI must contain exactly one ReceiptCreated event");
  }

  const event = events[0];
  if (event.anonymous !== false || !Array.isArray(event.inputs)) {
    throw new Error("ReceiptCreated ABI shape does not match the frozen V1 event");
  }

  const actualInputs = event.inputs.map(({ name, type, indexed }) => [name, type, indexed]);
  if (JSON.stringify(actualInputs) !== JSON.stringify(EXPECTED_RECEIPT_CREATED_INPUTS)) {
    throw new Error("ReceiptCreated ABI inputs do not match the frozen V1 event");
  }

  return event;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = readFileSync(new URL("../subgraph.yaml", import.meta.url), "utf8");
  const abi = JSON.parse(
    readFileSync(new URL("../abis/PlacementSettlementV1.json", import.meta.url), "utf8"),
  );
  const { address, startBlock } = validateManifest(manifest);
  validateReceiptAbi(abi);
  console.log(`deployment manifest ready: ${address} from block ${startBlock}`);
}
