import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const DAY = 24 * 60 * 60;
const VALIDITY = 30 * DAY;

enum Tier {
  None,
  Minimal,
  Moderate,
  Major,
}

describe("CREAttestationReceiver", function () {
  async function deployFixture() {
    const [admin, forwarder, simulator, deployco, impostor, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("AdvertiserRegistry", [admin.address, ethers.ZeroAddress]);
    await registry.waitForDeployment();

    const tiers = await ethers.deployContract("TierAttestation", [
      admin.address,
      ethers.ZeroAddress,
      VALIDITY,
    ]);
    await tiers.waitForDeployment();

    const receiver = await ethers.deployContract("CREAttestationReceiver", [
      admin.address,
      await registry.getAddress(),
      await tiers.getAddress(),
    ]);
    await receiver.waitForDeployment();

    // The receiver is the sole writer on both downstream contracts.
    await registry.connect(admin).grantRole(await registry.ATTESTOR_ROLE(), await receiver.getAddress());
    await tiers.connect(admin).grantRole(await tiers.ATTESTOR_ROLE(), await receiver.getAddress());

    await receiver.connect(admin).grantRole(await receiver.FORWARDER_ROLE(), forwarder.address);
    await receiver.connect(admin).grantRole(await receiver.SIMULATOR_ROLE(), simulator.address);

    await registry.connect(deployco).register("DeployCo", "deployco.com");

    return { registry, tiers, receiver, admin, forwarder, simulator, deployco, impostor, outsider };
  }

  /** Distinct forwarder metadata per delivery, as the real forwarder produces. */
  function metadata(tag: string): string {
    return ethers.solidityPacked(["bytes32"], [ethers.id(tag)]);
  }

  describe("wiring", function () {
    it("announces the Chainlink receiver interface via ERC-165", async function () {
      const { receiver } = await loadFixture(deployFixture);

      const onReport = ethers.id("onReport(bytes,bytes)").slice(0, 10);
      expect(await receiver.supportsInterface(onReport)).to.equal(true);
      expect(await receiver.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165 itself
      expect(await receiver.supportsInterface("0xdeadbeef")).to.equal(false);
    });

    it("holds the writer role on both downstream contracts, and nobody else does", async function () {
      const { registry, tiers, receiver, admin, forwarder } = await loadFixture(deployFixture);
      const receiverAddress = await receiver.getAddress();

      expect(await registry.hasRole(await registry.ATTESTOR_ROLE(), receiverAddress)).to.equal(true);
      expect(await tiers.hasRole(await tiers.ATTESTOR_ROLE(), receiverAddress)).to.equal(true);

      // Not even the deploying admin can write past the receiver.
      expect(await registry.hasRole(await registry.ATTESTOR_ROLE(), admin.address)).to.equal(false);
      expect(await tiers.hasRole(await tiers.ATTESTOR_ROLE(), admin.address)).to.equal(false);
      expect(await registry.hasRole(await registry.ATTESTOR_ROLE(), forwarder.address)).to.equal(false);
    });

    it("revoking the forwarder severs the oracle's write access in one transaction", async function () {
      const { registry, receiver, admin, forwarder, deployco } = await loadFixture(deployFixture);

      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        await registry.challengeOf(deployco.address),
        await time.latest(),
      );

      await receiver.connect(admin).revokeRole(await receiver.FORWARDER_ROLE(), forwarder.address);

      await expect(
        receiver.connect(forwarder).onReport(metadata("run-1"), report),
      ).to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount");
    });
  });

  describe("domain verification workflow", function () {
    it("verifies an advertiser whose challenge matches", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const challenge = await registry.challengeOf(deployco.address);
      const checkedAt = await time.latest();
      const report = await receiver.encodeDomainReport(deployco.address, true, challenge, checkedAt);

      await expect(receiver.connect(forwarder).onReport(metadata("run-1"), report))
        .to.emit(receiver, "DomainVerificationRecorded")
        .withArgs(deployco.address, true, challenge, BigInt(checkedAt))
        .and.to.emit(registry, "AdvertiserVerified");

      expect(await registry.isVerified(deployco.address)).to.equal(true);
    });

    it("records a negative verdict without verifying", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const challenge = await registry.challengeOf(deployco.address);
      const report = await receiver.encodeDomainReport(
        deployco.address,
        false,
        challenge,
        await time.latest(),
      );

      await expect(receiver.connect(forwarder).onReport(metadata("run-1"), report))
        .to.emit(receiver, "DomainVerificationRecorded")
        .withArgs(deployco.address, false, challenge, anyValue);

      expect(await registry.isVerified(deployco.address)).to.equal(false);
    });

    it("rejects a report whose challenge does not match the outstanding one", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        ethers.id("a challenge nobody issued"),
        await time.latest(),
      );

      await expect(
        receiver.connect(forwarder).onReport(metadata("run-1"), report),
      ).to.be.revertedWithCustomError(receiver, "ChallengeMismatch");

      expect(await registry.isVerified(deployco.address)).to.equal(false);
    });

    it("a verdict for an old claim cannot be applied after the claim changes", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      // The workflow checks deployco.com and the report is in flight...
      const oldChallenge = await registry.challengeOf(deployco.address);
      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        oldChallenge,
        await time.latest(),
      );

      // ...but the advertiser repoints its claim at a domain it may not control.
      await registry.connect(deployco).updateClaim("DeployCo", "deployco-totally-different.io");

      await expect(receiver.connect(forwarder).onReport(metadata("run-1"), report))
        .to.be.revertedWithCustomError(receiver, "ChallengeMismatch")
        .withArgs(await registry.challengeOf(deployco.address), oldChallenge);

      expect(await registry.isVerified(deployco.address)).to.equal(false);
    });

    it("rejects a report for an address that never registered", async function () {
      const { receiver, forwarder, outsider } = await loadFixture(deployFixture);

      const report = await receiver.encodeDomainReport(
        outsider.address,
        true,
        ethers.id("anything"),
        await time.latest(),
      );

      await expect(receiver.connect(forwarder).onReport(metadata("run-1"), report))
        .to.be.revertedWithCustomError(receiver, "AdvertiserNotRegistered")
        .withArgs(outsider.address);
    });

    it("rejects a check timestamped in the future", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const challenge = await registry.challengeOf(deployco.address);
      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        challenge,
        (await time.latest()) + 3600,
      );

      await expect(
        receiver.connect(forwarder).onReport(metadata("run-1"), report),
      ).to.be.revertedWithCustomError(receiver, "CheckTimestampInFuture");
    });

    it("an impostor cannot be verified into a brand another advertiser proved", async function () {
      const { registry, receiver, forwarder, simulator, deployco, impostor } =
        await loadFixture(deployFixture);

      await receiver
        .connect(simulator)
        .submitDomainVerification(
          deployco.address,
          true,
          await registry.challengeOf(deployco.address),
          await time.latest(),
        );

      // HostFast controls hostfast.io, so its own DNS check genuinely passes -
      // it just cannot land under a name DeployCo already holds.
      await registry.connect(impostor).register("DeployCo", "hostfast.io");
      const report = await receiver.encodeDomainReport(
        impostor.address,
        true,
        await registry.challengeOf(impostor.address),
        await time.latest(),
      );

      await expect(receiver.connect(forwarder).onReport(metadata("run-2"), report))
        .to.be.revertedWithCustomError(registry, "NameClaimedByAnother")
        .withArgs(deployco.address);

      expect(await registry.isVerified(impostor.address)).to.equal(false);
    });
  });

  describe("tier attestation workflow", function () {
    it("forwards a tier through to the attestation contract", async function () {
      const { tiers, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const end = await time.latest();
      const start = end - 30 * DAY;
      const report = await receiver.encodeTierReport(deployco.address, Tier.Moderate, start, end);

      await expect(receiver.connect(forwarder).onReport(metadata("tier-1"), report))
        .to.emit(receiver, "TierAttestationForwarded")
        .withArgs(deployco.address, BigInt(Tier.Moderate), BigInt(start), BigInt(end))
        .and.to.emit(tiers, "TierAttested");

      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.Moderate));
    });

    it("surfaces the downstream window check rather than swallowing it", async function () {
      const { receiver, forwarder, deployco, tiers } = await loadFixture(deployFixture);

      const end = await time.latest();
      const start = end - 30 * DAY;
      await receiver.connect(forwarder).onReport(
        metadata("tier-1"),
        await receiver.encodeTierReport(deployco.address, Tier.Major, start, end),
      );

      await expect(
        receiver
          .connect(forwarder)
          .onReport(
            metadata("tier-2"),
            await receiver.encodeTierReport(deployco.address, Tier.Minimal, start, end),
          ),
      ).to.be.revertedWithCustomError(tiers, "StaleWindow");
    });
  });

  describe("access and replay", function () {
    it("only the forwarder may call onReport", async function () {
      const { registry, receiver, outsider, simulator, deployco } = await loadFixture(deployFixture);

      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        await registry.challengeOf(deployco.address),
        await time.latest(),
      );

      await expect(
        receiver.connect(outsider).onReport(metadata("run-1"), report),
      ).to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount");

      // The simulator has its own door and cannot use the forwarder's.
      await expect(
        receiver.connect(simulator).onReport(metadata("run-1"), report),
      ).to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount");
    });

    it("only the simulator may use the simulation entry points", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      await expect(
        receiver
          .connect(forwarder)
          .submitDomainVerification(
            deployco.address,
            true,
            await registry.challengeOf(deployco.address),
            await time.latest(),
          ),
      ).to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount");
    });

    it("refuses to apply the same delivery twice", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        await registry.challengeOf(deployco.address),
        await time.latest(),
      );

      const md = metadata("run-1");
      await receiver.connect(forwarder).onReport(md, report);

      await expect(receiver.connect(forwarder).onReport(md, report))
        .to.be.revertedWithCustomError(receiver, "ReportAlreadyConsumed")
        .withArgs(ethers.keccak256(md));

      expect(await receiver.consumedReports(ethers.keccak256(md))).to.equal(true);
    });

    it("rejects an unrecognised report kind", async function () {
      const { receiver, forwarder } = await loadFixture(deployFixture);

      const bogus = ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [9, "0x"]);

      await expect(receiver.connect(forwarder).onReport(metadata("run-1"), bogus))
        .to.be.revertedWithCustomError(receiver, "UnknownReportKind")
        .withArgs(9);
    });

    it("emits the report kind and metadata hash for correlation", async function () {
      const { registry, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      const md = metadata("run-42");
      const report = await receiver.encodeDomainReport(
        deployco.address,
        true,
        await registry.challengeOf(deployco.address),
        await time.latest(),
      );

      await expect(receiver.connect(forwarder).onReport(md, report))
        .to.emit(receiver, "ReportProcessed")
        .withArgs(1, ethers.keccak256(md));
    });
  });

  describe("end to end, both workflows", function () {
    it("takes an advertiser from unverified to verified with a current tier", async function () {
      const { registry, tiers, receiver, forwarder, deployco } = await loadFixture(deployFixture);

      expect(await registry.isVerified(deployco.address)).to.equal(false);
      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.None));

      await receiver
        .connect(forwarder)
        .onReport(
          metadata("dns"),
          await receiver.encodeDomainReport(
            deployco.address,
            true,
            await registry.challengeOf(deployco.address),
            await time.latest(),
          ),
        );

      const end = await time.latest();
      await receiver
        .connect(forwarder)
        .onReport(
          metadata("tier"),
          await receiver.encodeTierReport(deployco.address, Tier.Moderate, end - 30 * DAY, end),
        );

      expect(await registry.isVerified(deployco.address)).to.equal(true);
      expect(await tiers.currentTierOf(deployco.address)).to.equal(BigInt(Tier.Moderate));
    });
  });
});
