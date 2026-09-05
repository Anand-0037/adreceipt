import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 24 * 60 * 60;
const LOCK = 7 * DAY;
const MIN_PLACEMENT = ethers.parseEther("0.001");
const TIER_VALIDITY = 30 * DAY;
const MAX_ACCOUNT_AGE = 7 * DAY;
const MIN_PLACEMENTS = 10;
const PARENT = "disclosed.eth";

enum Tier {
  None,
  Minimal,
  Moderate,
  Major,
}

/**
 * The demo, end to end, against the deployed role wiring rather than test
 * shortcuts: every state change below goes through the CRE receiver, exactly as
 * it would on Sepolia. All brands and figures here are fictional.
 */
describe("Integration - the four demo acts", function () {
  async function deployFixture() {
    const [admin, forwarder, deployco, renderstack, hostfast, user] = await ethers.getSigners();

    const registry = await ethers.deployContract("AdvertiserRegistry", [admin.address, ethers.ZeroAddress]);
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
      ethers.ZeroAddress,
      TIER_VALIDITY,
    ]);
    await tiers.waitForDeployment();

    const receiver = await ethers.deployContract("CREAttestationReceiver", [
      admin.address,
      await registry.getAddress(),
      await tiers.getAddress(),
    ]);
    await receiver.waitForDeployment();

    const resolver = await ethers.deployContract("PermissionedResolver", [
      admin.address,
      ethers.ZeroAddress,
    ]);
    await resolver.waitForDeployment();

    const subnames = await ethers.deployContract("DisclosedSubnameRegistry", [
      admin.address,
      await registry.getAddress(),
      await tiers.getAddress(),
      await resolver.getAddress(),
      ethers.namehash(PARENT),
      PARENT,
    ]);
    await subnames.waitForDeployment();

    const rule = await ethers.deployContract("SuspiciousPatternRule", [
      admin.address,
      await registry.getAddress(),
      await escrow.getAddress(),
      await tiers.getAddress(),
      MAX_ACCOUNT_AGE,
      MIN_PLACEMENTS,
    ]);
    await rule.waitForDeployment();

    // The same wiring scripts/deploy.ts performs.
    await registry.grantRole(await registry.ATTESTOR_ROLE(), await receiver.getAddress());
    await tiers.grantRole(await tiers.ATTESTOR_ROLE(), await receiver.getAddress());
    await resolver.grantRole(await resolver.CONTROLLER_ROLE(), await subnames.getAddress());
    await receiver.grantRole(await receiver.FORWARDER_ROLE(), forwarder.address);

    return {
      registry,
      escrow,
      tiers,
      receiver,
      resolver,
      subnames,
      rule,
      admin,
      forwarder,
      deployco,
      renderstack,
      hostfast,
      user,
    };
  }

  type Fixture = Awaited<ReturnType<typeof deployFixture>>;
  let runCounter = 0;

  /** Deliver a CRE report the way the forwarder does, with fresh metadata. */
  async function deliver(f: Fixture, report: string) {
    const metadata = ethers.solidityPacked(["bytes32"], [ethers.id(`cre-run-${++runCounter}`)]);
    return f.receiver.connect(f.forwarder).onReport(metadata, report);
  }

  async function verifyDomain(f: Fixture, who: { address: string }) {
    const challenge = await f.registry.challengeOf(who.address);
    const report = await f.receiver.encodeDomainReport(who.address, true, challenge, await time.latest());
    return deliver(f, report);
  }

  async function attestTier(f: Fixture, who: { address: string }, tier: Tier) {
    const end = await time.latest();
    const report = await f.receiver.encodeTierReport(who.address, tier, end - 30 * DAY, end);
    return deliver(f, report);
  }

  /** What the assistant reads to render one disclosure badge. */
  async function badge(f: Fixture, who: { address: string }) {
    const a = await f.registry.getAdvertiser(who.address);
    return {
      inRegistry: a.status !== 0n,
      verified: await f.registry.isVerified(who.address),
      domain: a.domain,
      name: await f.subnames.nameOfAdvertiser(who.address),
      tier: await f.tiers.currentTierOf(who.address),
      placements: await f.escrow.placementCount(who.address),
      registeredAt: a.registeredAt,
    };
  }

  describe("Act 1 - a recommendation you cannot check", function () {
    it("says nothing about a company outside the registry", async function () {
      const f = await loadFixture(deployFixture);

      // The assistant confidently recommends HostFast. All the registry can
      // truthfully report is that it has no record - never that it is fraudulent.
      const b = await badge(f, f.hostfast);
      expect(b.inRegistry).to.equal(false);
      expect(b.verified).to.equal(false);
      expect(b.name).to.equal("");
      expect(b.tier).to.equal(BigInt(Tier.None));
      expect(await f.registry.verifiedOwnerOfName("HostFast")).to.equal(ethers.ZeroAddress);
      expect((await f.rule.evaluate(f.hostfast.address)).registered).to.equal(false);
    });
  });

  describe("Act 2 - verification, live", function () {
    it("takes DeployCo from a bare claim to a named, verified, funded advertiser", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      expect((await badge(f, f.deployco)).verified).to.equal(false);

      await verifyDomain(f, f.deployco);
      await f.subnames.issue("deployco", f.deployco.address);
      await f.escrow
        .connect(f.deployco)
        .createPlacement("backend hosting", { value: ethers.parseEther("3") });
      await attestTier(f, f.deployco, Tier.Moderate);
      await f.subnames.syncRecords(f.deployco.address);

      const b = await badge(f, f.deployco);
      expect(b.verified).to.equal(true);
      expect(b.domain).to.equal("deployco.com");
      expect(b.name).to.equal("deployco.disclosed.eth");
      expect(b.tier).to.equal(BigInt(Tier.Moderate));
      expect(b.placements).to.equal(1n);

      const node = await f.subnames.nodeOf(f.deployco.address);
      expect(await f.resolver.text(node, "disclosed.verified")).to.equal("true");
      expect(await f.resolver.text(node, "disclosed.tier")).to.equal("moderate");
      expect(await f.resolver.text(node, "disclosed.domain")).to.equal("deployco.com");
    });

    it("rejects the impersonator at the confidential DNS check - the centrepiece", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);
      await f.subnames.issue("deployco", f.deployco.address);

      // HostFast claims the DeployCo brand. Registration is open to anyone, so
      // this step succeeds - and proves nothing.
      await f.registry.connect(f.hostfast).register("DeployCo", "deployco-hosting.io");
      expect(await f.registry.isVerified(f.hostfast.address)).to.equal(false);

      // A forged verdict fails: the challenge is per-claim and it does not have
      // the one this claim is waiting on.
      const forged = await f.receiver.encodeDomainReport(
        f.hostfast.address,
        true,
        await f.registry.challengeOf(f.deployco.address),
        await time.latest(),
      );
      await expect(deliver(f, forged)).to.be.revertedWithCustomError(f.receiver, "ChallengeMismatch");

      // Even an honest verdict fails: it controls deployco-hosting.io, but the
      // DeployCo brand is already proved by someone else.
      await expect(verifyDomain(f, f.hostfast))
        .to.be.revertedWithCustomError(f.registry, "NameClaimedByAnother")
        .withArgs(f.deployco.address);

      // So it can never be surfaced as a paid recommendation.
      await expect(
        f.escrow.connect(f.hostfast).createPlacement("backend hosting", { value: ethers.parseEther("5") }),
      ).to.be.revertedWithCustomError(f.escrow, "AdvertiserNotVerified");

      await expect(
        f.subnames.issue("deployco-official", f.hostfast.address),
      ).to.be.revertedWithCustomError(f.subnames, "AdvertiserNotVerified");
    });

    it("will not let a verified advertiser mark itself verified on its own name", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.renderstack).register("RenderStack", "renderstack.com");
      await verifyDomain(f, f.renderstack);
      await f.subnames.issue("renderstack", f.renderstack.address);
      const node = await f.subnames.nodeOf(f.renderstack.address);

      // It owns the name outright and can set its own profile...
      await f.resolver.connect(f.renderstack).setText(node, "url", "https://renderstack.com");
      expect(await f.resolver.text(node, "url")).to.equal("https://renderstack.com");

      // ...but the claims the registry makes about it are not its to write.
      await expect(
        f.resolver.connect(f.renderstack).setText(node, "disclosed.tier", "major"),
      ).to.be.revertedWithCustomError(f.resolver, "UnauthorizedRecordWrite");
    });
  });

  describe("Act 3 - proportional trust", function () {
    it("separates two legitimately verified advertisers a binary label would flatten", async function () {
      const f = await loadFixture(deployFixture);

      // DeployCo pays. RenderStack verifies for free and never pays a penny.
      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);
      await f.subnames.issue("deployco", f.deployco.address);
      await f.escrow
        .connect(f.deployco)
        .createPlacement("backend hosting", { value: ethers.parseEther("8") });
      await attestTier(f, f.deployco, Tier.Moderate);

      await f.registry.connect(f.renderstack).register("RenderStack", "renderstack.com");
      await verifyDomain(f, f.renderstack);
      await f.subnames.issue("renderstack", f.renderstack.address);

      const paid = await badge(f, f.deployco);
      const unpaid = await badge(f, f.renderstack);

      // Both verified - a boolean would render them identically.
      expect(paid.verified).to.equal(true);
      expect(unpaid.verified).to.equal(true);

      // The tier is what distinguishes them.
      expect(paid.tier).to.equal(BigInt(Tier.Moderate));
      expect(unpaid.tier).to.equal(BigInt(Tier.None));
      expect(unpaid.placements).to.equal(0n);
    });

    it("hiding sponsored results leaves the unpaid advertiser standing", async function () {
      const f = await loadFixture(deployFixture);

      for (const [who, label, domain] of [
        [f.deployco, "deployco", "deployco.com"],
        [f.renderstack, "renderstack", "renderstack.com"],
      ] as const) {
        await f.registry.connect(who).register(label, domain);
        await verifyDomain(f, who);
        await f.subnames.issue(label, who.address);
      }
      await f.escrow
        .connect(f.deployco)
        .createPlacement("backend hosting", { value: ethers.parseEther("8") });
      await attestTier(f, f.deployco, Tier.Major);

      const candidates = [f.deployco, f.renderstack];
      const badges = await Promise.all(candidates.map((c) => badge(f, c)));

      const all = badges.filter((b) => b.verified);
      const unpaidOnly = badges.filter((b) => b.verified && b.tier === BigInt(Tier.None));

      expect(all).to.have.lengthOf(2);
      expect(unpaidOnly).to.have.lengthOf(1);
      expect(unpaidOnly[0].name).to.equal("renderstack.disclosed.eth");
    });

    it("the exact amount is never recoverable from chain state the badge reads", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);
      await f.escrow
        .connect(f.deployco)
        .createPlacement("backend hosting", { value: ethers.parseEther("7.35") });
      await attestTier(f, f.deployco, Tier.Moderate);

      // The tier contract holds a bucket and three timestamps. Nothing else.
      const fragment = f.tiers.interface.getFunction("getAttestation");
      expect(fragment.outputs[0].components?.map((c) => c.name)).to.deep.equal([
        "tier",
        "windowStart",
        "windowEnd",
        "attestedAt",
      ]);

      const attestation = await f.tiers.getAttestation(f.deployco.address);
      expect(attestation.tier).to.equal(BigInt(Tier.Moderate));

      // The escrow knows the exact figure; nothing the badge reads exposes it.
      expect(await f.escrow.lifetimeDeposited(f.deployco.address)).to.equal(ethers.parseEther("7.35"));
    });
  });

  describe("Act 4 - the auditor view", function () {
    it("flags the days-old advertiser already placing aggressively at the top tier", async function () {
      const f = await loadFixture(deployFixture);

      // An established advertiser, and a brand-new one behaving very differently.
      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);
      await f.escrow
        .connect(f.deployco)
        .createPlacement("backend hosting", { value: ethers.parseEther("2") });
      await time.increase(MAX_ACCOUNT_AGE + DAY);
      await attestTier(f, f.deployco, Tier.Major);

      await f.registry.connect(f.hostfast).register("HostFast", "hostfast.io");
      await verifyDomain(f, f.hostfast);
      for (let i = 0; i < 11; i++) {
        await f.escrow
          .connect(f.hostfast)
          .createPlacement("backend hosting", { value: ethers.parseEther("0.5") });
      }
      await attestTier(f, f.hostfast, Tier.Major);

      const [established, fresh] = await f.rule.evaluateMany([
        f.deployco.address,
        f.hostfast.address,
      ]);

      expect(established.flagged).to.equal(false);
      expect(fresh.flagged).to.equal(true);
      expect(fresh.placements).to.equal(11n);
      expect(fresh.tier).to.equal(BigInt(Tier.Major));
      expect(fresh.accountAge).to.be.lessThan(BigInt(MAX_ACCOUNT_AGE));
    });
  });

  describe("what the registry structurally cannot do", function () {
    it("cannot record a payment that did not flow through its own escrow", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);

      // No admin path deposits on someone's behalf, and value cannot arrive
      // any other way.
      await expect(
        f.admin.sendTransaction({ to: await f.escrow.getAddress(), value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(f.escrow, "DirectPaymentRejected");

      expect(await f.escrow.lifetimeDeposited(f.deployco.address)).to.equal(0n);
      expect(await f.tiers.currentTierOf(f.deployco.address)).to.equal(BigInt(Tier.None));
    });

    it("cannot be driven by anyone but the forwarder once roles are wired", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      const challenge = await f.registry.challengeOf(f.deployco.address);

      // Not the admin, and not the advertiser.
      await expect(
        f.registry.connect(f.admin).setVerified(f.deployco.address, true),
      ).to.be.revertedWithCustomError(f.registry, "AccessControlUnauthorizedAccount");

      const report = await f.receiver.encodeDomainReport(
        f.deployco.address,
        true,
        challenge,
        await time.latest(),
      );
      await expect(
        f.receiver.connect(f.deployco).onReport(ethers.id("forged"), report),
      ).to.be.revertedWithCustomError(f.receiver, "AccessControlUnauthorizedAccount");
    });

    it("survives losing the oracle: revoke the forwarder and nothing further can be written", async function () {
      const f = await loadFixture(deployFixture);

      await f.registry.connect(f.deployco).register("DeployCo", "deployco.com");
      await verifyDomain(f, f.deployco);
      await f.subnames.issue("deployco", f.deployco.address);

      await f.receiver.revokeRole(await f.receiver.FORWARDER_ROLE(), f.forwarder.address);

      await expect(attestTier(f, f.deployco, Tier.Major)).to.be.revertedWithCustomError(
        f.receiver,
        "AccessControlUnauthorizedAccount",
      );

      // What was already attested stands, and the name still resolves.
      expect(await f.registry.isVerified(f.deployco.address)).to.equal(true);
      expect(await f.subnames.nameOfAdvertiser(f.deployco.address)).to.equal("deployco.disclosed.eth");
    });
  });
});
