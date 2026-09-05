import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { FunctionFragment, EventFragment } from "ethers";

const DAY = 24 * 60 * 60;
const VALIDITY = 30 * DAY;

enum Tier {
  None,
  Minimal,
  Moderate,
  Major,
}

describe("TierAttestation", function () {
  async function deployFixture() {
    const [admin, attestor, deployco, renderstack, outsider] = await ethers.getSigners();

    const tiers = await ethers.deployContract("TierAttestation", [
      admin.address,
      attestor.address,
      VALIDITY,
    ]);
    await tiers.waitForDeployment();

    return { tiers, admin, attestor, deployco, renderstack, outsider };
  }

  /** A window that ends now and started `span` seconds ago. */
  async function windowEndingNow(span: number): Promise<[number, number]> {
    const end = await time.latest();
    return [end - span, end];
  }

  describe("deployment", function () {
    it("stores its validity and grants the attestor role", async function () {
      const { tiers, admin, attestor } = await loadFixture(deployFixture);

      expect(await tiers.attestationValidity()).to.equal(BigInt(VALIDITY));
      expect(await tiers.hasRole(await tiers.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await tiers.hasRole(await tiers.ATTESTOR_ROLE(), attestor.address)).to.equal(true);
    });

    it("refuses a validity of zero or one beyond the hard cap", async function () {
      const { admin, attestor } = await loadFixture(deployFixture);
      const Tiers = await ethers.getContractFactory("TierAttestation");

      await expect(Tiers.deploy(admin.address, attestor.address, 0)).to.be.revertedWithCustomError(
        Tiers,
        "ValidityTooLong",
      );
      await expect(
        Tiers.deploy(admin.address, attestor.address, 181 * DAY),
      ).to.be.revertedWithCustomError(Tiers, "ValidityTooLong");
    });
  });

  describe("recordTier", function () {
    it("stores the bucket and emits it", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await expect(tiers.connect(attestor).recordTier(deployco.address, Tier.Moderate, start, end))
        .to.emit(tiers, "TierAttested")
        .withArgs(deployco.address, BigInt(Tier.Moderate), BigInt(start), BigInt(end), anyValue);

      expect(await tiers.tierOf(deployco.address)).to.equal(BigInt(Tier.Moderate));
      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.Moderate));
      expect(await tiers.isCurrent(deployco.address)).to.equal(true);

      const a = await tiers.getAttestation(deployco.address);
      expect(a.windowStart).to.equal(BigInt(start));
      expect(a.windowEnd).to.equal(BigInt(end));
      expect(a.attestedAt).to.be.greaterThan(0n);
    });

    it("only the attestor may write", async function () {
      const { tiers, admin, outsider, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await expect(
        tiers.connect(outsider).recordTier(deployco.address, Tier.Major, start, end),
      ).to.be.revertedWithCustomError(tiers, "AccessControlUnauthorizedAccount");

      // The admin holds the keys to the thresholds, not to the attestations.
      await expect(
        tiers.connect(admin).recordTier(deployco.address, Tier.Major, start, end),
      ).to.be.revertedWithCustomError(tiers, "AccessControlUnauthorizedAccount");
    });

    it("rejects Tier.None - absence already means no payment on record", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await expect(
        tiers.connect(attestor).recordTier(deployco.address, Tier.None, start, end),
      ).to.be.revertedWithCustomError(tiers, "InvalidTier");
    });

    it("rejects the zero address and inverted windows", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await expect(
        tiers.connect(attestor).recordTier(ethers.ZeroAddress, Tier.Major, start, end),
      ).to.be.revertedWithCustomError(tiers, "InvalidAdvertiser");

      await expect(tiers.connect(attestor).recordTier(deployco.address, Tier.Major, end, start))
        .to.be.revertedWithCustomError(tiers, "InvalidWindow")
        .withArgs(BigInt(end), BigInt(start));
    });

    it("rejects a window that has not closed yet", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        tiers.connect(attestor).recordTier(deployco.address, Tier.Major, now - DAY, now + DAY),
      ).to.be.revertedWithCustomError(tiers, "WindowInFuture");
    });

    it("requires each window to move forward", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);

      // Replaying the same report, or an older one, cannot rewrite the tier.
      await expect(tiers.connect(attestor).recordTier(deployco.address, Tier.Minimal, start, end))
        .to.be.revertedWithCustomError(tiers, "StaleWindow")
        .withArgs(BigInt(end), BigInt(end));

      await expect(
        tiers.connect(attestor).recordTier(deployco.address, Tier.Minimal, start - DAY, end - DAY),
      ).to.be.revertedWithCustomError(tiers, "StaleWindow");

      expect(await tiers.tierOf(deployco.address)).to.equal(BigInt(Tier.Major));
    });

    it("accepts a later window and lets the tier move in either direction", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);
      await time.increase(DAY);

      const laterEnd = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Minimal, laterEnd - 30 * DAY, laterEnd);

      expect(await tiers.tierOf(deployco.address)).to.equal(BigInt(Tier.Minimal));
    });

    it("enumerates attested advertisers once each", async function () {
      const { tiers, attestor, deployco, renderstack } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);
      await tiers.connect(attestor).recordTier(renderstack.address, Tier.Minimal, start, end);
      await time.increase(DAY);
      const laterEnd = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Moderate, start, laterEnd);

      expect(await tiers.attestedCount()).to.equal(2n);
      expect(await tiers.attestedAt(0)).to.equal(deployco.address);
      expect(await tiers.attestedAt(1)).to.equal(renderstack.address);
    });
  });

  describe("staleness", function () {
    it("stops reporting a tier as current once it expires", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);
      await time.increase(VALIDITY + 1);

      // The raw record survives for auditing; the badge-facing view does not.
      expect(await tiers.tierOf(deployco.address)).to.equal(BigInt(Tier.Major));
      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.None));
      expect(await tiers.isCurrent(deployco.address)).to.equal(false);
    });

    it("a re-attestation makes it current again", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);
      await time.increase(VALIDITY + 1);

      const laterEnd = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, laterEnd - 30 * DAY, laterEnd);

      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.Major));
    });

    it("reports None for an advertiser that was never attested", async function () {
      const { tiers, outsider } = await loadFixture(deployFixture);

      expect(await tiers.tierOf(outsider.address)).to.equal(BigInt(Tier.None));
      expect(await tiers.currentTierOf(outsider.address)).to.equal(BigInt(Tier.None));
      expect(await tiers.isCurrent(outsider.address)).to.equal(false);
    });

    it("lets the admin retune validity within the cap", async function () {
      const { tiers, admin, outsider } = await loadFixture(deployFixture);

      await expect(tiers.connect(admin).setAttestationValidity(60 * DAY))
        .to.emit(tiers, "AttestationValidityUpdated")
        .withArgs(BigInt(VALIDITY), BigInt(60 * DAY));

      await expect(tiers.connect(admin).setAttestationValidity(181 * DAY)).to.be.revertedWithCustomError(
        tiers,
        "ValidityTooLong",
      );
      await expect(tiers.connect(outsider).setAttestationValidity(DAY)).to.be.revertedWithCustomError(
        tiers,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("the exact figure never lands here", function () {
    it("no function in the ABI accepts an amount", async function () {
      const { tiers } = await loadFixture(deployFixture);

      const inputNames = tiers.interface.fragments
        .filter((f): f is FunctionFragment => f.type === "function")
        .flatMap((f) => f.inputs.map((i) => i.name.toLowerCase()));

      for (const banned of ["amount", "spend", "wei", "value", "total", "cumulative"]) {
        expect(inputNames.filter((n) => n.includes(banned)), `input named *${banned}*`).to.deep.equal([]);
      }
    });

    it("no event in the ABI carries an amount", async function () {
      const { tiers } = await loadFixture(deployFixture);

      const eventArgs = tiers.interface.fragments
        .filter((f): f is EventFragment => f.type === "event")
        .flatMap((f) => f.inputs.map((i) => i.name.toLowerCase()));

      for (const banned of ["amount", "spend", "wei", "value", "cumulative"]) {
        expect(eventArgs.filter((n) => n.includes(banned)), `event arg named *${banned}*`).to.deep.equal([]);
      }
    });

    it("the only spend-shaped output is a four-value enum", async function () {
      const { tiers, attestor, deployco } = await loadFixture(deployFixture);
      const [start, end] = await windowEndingNow(30 * DAY);

      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, start, end);

      // Whatever the advertiser actually spent, all an observer can recover is 3.
      expect(await tiers.tierOf(deployco.address)).to.equal(3n);
      expect(Object.keys(Tier).length / 2).to.equal(4);
    });
  });
});
