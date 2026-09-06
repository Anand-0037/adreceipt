import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = readFileSync(new URL("../subgraph.yaml", import.meta.url), "utf8");
  const { address, startBlock } = validateManifest(manifest);
  console.log(`deployment manifest ready: ${address} from block ${startBlock}`);
}
