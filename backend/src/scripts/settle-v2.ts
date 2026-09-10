import { config } from "../config";
import { settleSignedPlacement } from "../v2/settlement";
import { V2Store } from "../v2/store";

async function main() {
  const placementId = process.argv.find((argument) => /^0x[0-9a-f]{64}$/i.test(argument));
  const broadcast = process.argv.includes("--broadcast");
  if (!placementId) throw new Error("Usage: npm run settle:v2 -- 0x<placementId> --broadcast");
  if (!broadcast) {
    throw new Error(
      "The settlement command broadcasts only with --broadcast. Review the signed placement through the API or database first.",
    );
  }

  const store = new V2Store(config.databaseUrl);
  try {
    console.log(JSON.stringify(await settleSignedPlacement(store, placementId), null, 2));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
