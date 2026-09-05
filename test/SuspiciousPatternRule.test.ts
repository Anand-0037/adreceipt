import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 24 * 60 * 60;
const VALIDITY = 30 * DAY;
const LOCK = 7 * DAY;
const MIN_PLACEMENT = ethers.parseEther("0.001");

const MAX_ACCOUNT_AGE = 7 * DAY;
const MIN_PLACEMENTS = 10;

enum Tier {
  None,
  Minimal,
  Moderate,
  Major,
}

describe("SuspiciousPatternRule", function () {
  async function deployFixture() {
    const [admin, attestor, hostfast, deployco, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("AdvertiserRegistry", [admin.address, attestor.address]);
    await registry.waitForDeployment();

    const escrow = await ethers.deployContract("PlacementEscrow", [
      admin.address,
      await registry.getAddress(),
      LOCK,
      MIN_PLACEMENT,
    ]);
    await escrow.waitForDeployment();

    const tiers = await ethers.deployContract("TierAttestation", [
      admin.address,
      attestor.address,
      VALIDITY,
    ]);
    await tiers.waitForDeployment();

    const rule = await ethers.deployContract("SuspiciousPatternRule", [
      admin.address,
      await registry.getAddress(),
      await escrow.getAddress(),
      await tiers.getAddress(),
      MAX_ACCOUNT_AGE,
      MIN_PLACEMENTS,
    ]);
    await rule.waitForDeployment();

    return { registry, escrow, tiers, rule, admin, attestor, hostfast, deployco, outsider };
  }

  /** Register, verify, and place `count` deposits in one go. */
  async function onboard(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    who: (typeof fixture)["hostfast"],
    name: string,
    domain: string,
    placements: number,
  ) {
    const { registry, escrow, attestor } = fixture;
    await registry.connect(who).register(name, domain);
    await registry.connect(attestor).setVerified(who.address, true);
    for (let i = 0; i < placements; i++) {
      await escrow.connect(who).createPlacement("backend hosting", { value: ethers.parseEther("0.5") });
    }
  }

  async function attestTier(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    who: (typeof fixture)["hostfast"],
    tier: Tier,
  ) {
    const end = await time.latest();
    await fixture.tiers.connect(fixture.attestor).recordTier(who.address, tier, end - 30 * DAY, end);
  }

  describe("the rule", function () {
    it("flags a days-old advertiser placing aggressively at Major tier", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, hostfast } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 11);
      await attestTier(f, hostfast, Tier.Major);

      const e = await rule.evaluate(hostfast.address);
      expect(e.flagged).to.equal(true);
      expect(e.registered).to.equal(true);
      expect(e.placements).to.equal(11n);
      expect(e.tier).to.equal(BigInt(Tier.Major));
      expect(e.accountAge).to.be.lessThan(BigInt(MAX_ACCOUNT_AGE));

      expect(await rule.isFlagged(hostfast.address)).to.equal(true);
    });

    it("does not flag an established advertiser with the same spend and volume", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, deployco } = f;

      await onboard(f, deployco, "DeployCo", "deployco.com", 11);
      await time.increase(MAX_ACCOUNT_AGE + 1);
      await attestTier(f, deployco, Tier.Major);

      const e = await rule.evaluate(deployco.address);
      expect(e.flagged).to.equal(false);
      expect(e.accountAge).to.be.greaterThan(BigInt(MAX_ACCOUNT_AGE));
      expect(e.placements).to.equal(11n);
      expect(e.tier).to.equal(BigInt(Tier.Major));
    });

    it("does not flag a new advertiser at ten placements - the rule is strictly more than ten", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, hostfast } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 10);
      await attestTier(f, hostfast, Tier.Major);

      const e = await rule.evaluate(hostfast.address);
      expect(e.placements).to.equal(10n);
      expect(e.flagged).to.equal(false);
    });

    it("does not flag a new, busy advertiser below Major tier", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, hostfast } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 11);
      await attestTier(f, hostfast, Tier.Moderate);

      expect(await rule.isFlagged(hostfast.address)).to.equal(false);
    });

    it("unflags once the Major attestation goes stale", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, hostfast } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 11);
      await attestTier(f, hostfast, Tier.Major);
      expect(await rule.isFlagged(hostfast.address)).to.equal(true);

      // Time passes: the tier expires, but so does the account being new. Both
      // legs fall away together, which is the intended behaviour - the rule is
      // about a burst, not a permanent mark.
      await time.increase(VALIDITY + 1);

      const e = await rule.evaluate(hostfast.address);
      expect(e.tier).to.equal(BigInt(Tier.None));
      expect(e.flagged).to.equal(false);
    });
  });

  describe("advertisers outside the registry", function () {
    it("says nothing at all about an address that never registered", async function () {
      const { rule, outsider } = await loadFixture(deployFixture);

      const e = await rule.evaluate(outsider.address);
      expect(e.registered).to.equal(false);
      expect(e.flagged).to.equal(false);
      expect(e.accountAge).to.equal(0n);
      expect(e.placements).to.equal(0n);
      expect(e.tier).to.equal(BigInt(Tier.None));
    });
  });

  describe("auditor dashboard", function () {
    it("evaluates a batch in one call", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, hostfast, deployco, outsider } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 11);
      await attestTier(f, hostfast, Tier.Major);
      await onboard(f, deployco, "DeployCo", "deployco.com", 2);
      await attestTier(f, deployco, Tier.Moderate);

      const results = await rule.evaluateMany([hostfast.address, deployco.address, outsider.address]);
      expect(results.map((r) => r.flagged)).to.deep.equal([true, false, false]);
      expect(results.map((r) => r.registered)).to.deep.equal([true, true, false]);
    });
  });

  describe("thresholds", function () {
    it("lets a curator retune them, and the flag follows", async function () {
      const f = await loadFixture(deployFixture);
      const { rule, admin, hostfast } = f;

      await onboard(f, hostfast, "HostFast", "hostfast.io", 11);
      await attestTier(f, hostfast, Tier.Major);
      expect(await rule.isFlagged(hostfast.address)).to.equal(true);

      await expect(rule.connect(admin).setThresholds(7 * DAY, 20))
        .to.emit(rule, "ThresholdsUpdated")
        .withArgs(BigInt(7 * DAY), 20n);

      expect(await rule.isFlagged(hostfast.address)).to.equal(false);
    });

    it("rejects a zero age threshold and non-curators", async function () {
      const { rule, admin, outsider } = await loadFixture(deployFixture);

      await expect(rule.connect(admin).setThresholds(0, 10)).to.be.revertedWithCustomError(
        rule,
        "InvalidThreshold",
      );
      await expect(rule.connect(outsider).setThresholds(DAY, 5)).to.be.revertedWithCustomError(
        rule,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("holds no advertiser state of its own - only the two thresholds", async function () {
      const { rule } = await loadFixture(deployFixture);

      // Nothing on this contract can mark an individual advertiser directly;
      // the flag is always recomputed from the three source contracts.
      const writes = rule.interface.fragments
        .filter((f) => f.type === "function")
        .filter((f) => "stateMutability" in f && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => ("name" in f ? f.name : ""));

      expect(writes.sort()).to.deep.equal(["grantRole", "renounceRole", "revokeRole", "setThresholds"]);
    });
  });
});
