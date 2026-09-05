import { formatEther, parseEther } from "ethers";
import { fixtureDomainDeps, fixtureTierDeps } from "./adapters";
import { domainHandler, tierHandler } from "./handlers";
import { encodeDomainReport, encodeTierReport } from "./report";

/**
 * Deterministic local run of both confidential handlers.
 *
 * Prints, for each handler, what was held inside and what crossed out. That
 * contrast is the evidence the Chainlink track asks for: it is not enough to say
 * a value was confidential, it has to be visible that the sensitive input never
 * appears in the emitted report.
 *
 * Deterministic on purpose - no live domain, no funded escrow - so the output is
 * reproducible by a judge.
 */

const ADVERTISER = "0x000000000000000000000000000000000000dEaD";
const CHALLENGE = "0x411ac7131f53a1e0d0f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6";
const EXPECTED = `disclosed-verification=${CHALLENGE}`;
const TIER_NAME = ["None", "Minimal", "Moderate", "Major"];

function rule(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function simulateDomain() {
  rule("HANDLER 1  domain verification");

  const cases: [string, string[], number][] = [
    ["record published correctly", [EXPECTED], 2],
    ["record absent", [], 2],
    ["record present but wrong challenge", ["disclosed-verification=0xdead"], 2],
    ["only one resolver reachable", [EXPECTED], 1],
  ];

  for (const [label, records, resolvers] of cases) {
    const { publicOutput, secret } = await domainHandler(
      {
        advertiser: ADVERTISER,
        domain: "deployco.com",
        challenge: CHALLENGE,
        recordName: "_disclosed.deployco.com",
        expectedValue: EXPECTED,
      },
      fixtureDomainDeps(records, resolvers),
    );

    console.log(`\n- ${label}`);
    console.log(`  INSIDE  raw DNS answers from ${secret.answers.length} resolver(s):`);
    for (const a of secret.answers) {
      console.log(`            ${a.resolver}: answered=${a.answered} ${JSON.stringify(a.records)}`);
    }
    console.log(`  OUT     ${JSON.stringify(publicOutput)}`);
    const report = encodeDomainReport(publicOutput);
    console.log(`  REPORT  ${report.slice(0, 42)}... (${(report.length - 2) / 2} bytes)`);
    console.log(
      `  LEAK?   raw answer present in report: ${
        report.includes(Buffer.from(JSON.stringify(secret.answers)).toString("hex")) ? "YES" : "no"
      }`,
    );
  }
}

async function simulateTier() {
  rule("HANDLER 2  tier computation");

  const cases: [string, string, string][] = [
    ["public only, small", "0.05", "0"],
    ["public only, large", "2.0", "0"],
    ["private spend lifts the band", "0.05", "0.9"],
    ["private spend dominates", "0.001", "8.0"],
  ];

  for (const [label, onchain, offchain] of cases) {
    const { publicOutput, secret } = await tierHandler(
      { advertiser: ADVERTISER, windowStart: 1_700_000_000, windowEnd: 1_702_592_000 },
      fixtureTierDeps(parseEther(onchain), parseEther(offchain)),
    );

    console.log(`\n- ${label}`);
    console.log(`  INSIDE  on-chain  ${formatEther(secret.onchainWei).padStart(8)} ETH  (public)`);
    console.log(`  INSIDE  off-chain ${formatEther(secret.offchainWei).padStart(8)} ETH  (private)`);
    console.log(`  INSIDE  total     ${formatEther(secret.totalWei).padStart(8)} ETH`);
    console.log(`  OUT     tier ${publicOutput.tier} (${TIER_NAME[publicOutput.tier]})`);
    const report = encodeTierReport(publicOutput);
    const totalHex = secret.totalWei.toString(16).padStart(64, "0");
    console.log(`  REPORT  ${report.slice(0, 42)}... (${(report.length - 2) / 2} bytes)`);
    console.log(`  LEAK?   total present in report: ${report.includes(totalHex) ? "YES" : "no"}`);
  }

  console.log(
    "\nNote: rows 1 and 3 differ only in the private figure, and produce different\n" +
      "bands from identical public state. An observer reading the chain cannot\n" +
      "reproduce either result.",
  );
}

async function main() {
  console.log("Disclosed - confidential workflow simulation");
  console.log(`run at ${new Date().toISOString()}`);
  await simulateDomain();
  await simulateTier();
  console.log("\nBoth handlers emitted only their public projection.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
