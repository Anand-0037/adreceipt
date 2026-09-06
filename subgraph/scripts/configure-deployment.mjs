import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateManifest } from "./validate-deployment.mjs";

const MANIFEST_URL = new URL("../subgraph.yaml", import.meta.url);

export function configureManifest(manifest, { address, startBlock, network = "sepolia" }) {
  if (network !== "sepolia") {
    throw new Error('SUBGRAPH_NETWORK must be "sepolia"');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
    throw new Error("PLACEMENT_SETTLEMENT_ADDRESS must be a valid EVM address");
  }

  const parsedStartBlock = Number(startBlock);
  if (!Number.isSafeInteger(parsedStartBlock) || parsedStartBlock <= 0) {
    throw new Error("PLACEMENT_SETTLEMENT_START_BLOCK must be a positive integer");
  }

  const configured = manifest
    .replace(/^(\s*network:)\s*[^\s]+\s*$/m, `$1 ${network}`)
    .replace(/^(\s*address:)\s*["']?[^"'\s]+["']?\s*$/m, `$1 "${address}"`)
    .replace(/^(\s*startBlock:)\s*\d+\s*$/m, `$1 ${parsedStartBlock}`);

  validateManifest(configured);
  return configured;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = readFileSync(MANIFEST_URL, "utf8");
  const configured = configureManifest(manifest, {
    address: process.env.PLACEMENT_SETTLEMENT_ADDRESS,
    startBlock: process.env.PLACEMENT_SETTLEMENT_START_BLOCK,
    network: process.env.SUBGRAPH_NETWORK ?? "sepolia",
  });

  writeFileSync(MANIFEST_URL, configured);
  console.log(
    `configured subgraph.yaml for sepolia ${process.env.PLACEMENT_SETTLEMENT_ADDRESS} from block ${process.env.PLACEMENT_SETTLEMENT_START_BLOCK}`,
  );
}
