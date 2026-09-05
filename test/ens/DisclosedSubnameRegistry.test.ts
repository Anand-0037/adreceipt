import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { FunctionFragment } from "ethers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const DAY = 24 * 60 * 60;
const VALIDITY = 30 * DAY;
const PARENT = "disclosed.eth";

enum Tier {
  None,
  Minimal,
  Moderate,
  Major,
}

describe("DisclosedSubnameRegistry", function () {
  async function deployFixture() {
    const [admin, attestor, deployco, renderstack, outsider] = await ethers.getSigners();

    const advertisers = await ethers.deployContract("AdvertiserRegistry", [admin.address, attestor.address]);
    await advertisers.waitForDeployment();

    const tiers = await ethers.deployContract("TierAttestation", [
      admin.address,
      attestor.address,
      VALIDITY,
    ]);
    await tiers.waitForDeployment();

    const resolver = await ethers.deployContract("PermissionedResolver", [
      admin.address,
      ethers.ZeroAddress,
    ]);
    await resolver.waitForDeployment();

    const subnames = await ethers.deployContract("DisclosedSubnameRegistry", [
      admin.address,
      await advertisers.getAddress(),
      await tiers.getAddress(),
      await resolver.getAddress(),
      ethers.namehash(PARENT),
      PARENT,
    ]);
    await subnames.waitForDeployment();

    await resolver
      .connect(admin)
      .grantRole(await resolver.CONTROLLER_ROLE(), await subnames.getAddress());

    await advertisers.connect(deployco).register("DeployCo", "deployco.com");
    await advertisers.connect(attestor).setVerified(deployco.address, true);
    await advertisers.connect(renderstack).register("RenderStack", "renderstack.com");

    return { advertisers, tiers, resolver, subnames, admin, attestor, deployco, renderstack, outsider };
  }

  describe("issuance", function () {
    it("issues a subname under the parent and hands ownership to the advertiser", async function () {
      const { subnames, resolver, admin, deployco } = await loadFixture(deployFixture);

      const node = ethers.namehash(`deployco.${PARENT}`);

      await expect(subnames.connect(admin).issue("deployco", deployco.address))
        .to.emit(subnames, "SubnameIssued")
        .withArgs(node, deployco.address, "deployco", `deployco.${PARENT}`, anyValue);

      expect(await subnames.nodeOf(deployco.address)).to.equal(node);
      expect(await subnames.advertiserOf(node)).to.equal(deployco.address);
      expect(await subnames.fullNameOf(node)).to.equal("deployco.disclosed.eth");
      expect(await subnames.nameOfAdvertiser(deployco.address)).to.equal("deployco.disclosed.eth");

      // The node computed on-chain matches ENS namehash, so ordinary ENS tooling
      // resolves it without special-casing.
      expect(await subnames.nodeForLabel("deployco")).to.equal(node);
      expect(await resolver.nodeOwner(node)).to.equal(deployco.address);
    });

    it("writes the claim facts and the current status as text records", async function () {
      const { subnames, resolver, tiers, advertisers, admin, attestor, deployco } =
        await loadFixture(deployFixture);

      const end = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Moderate, end - 30 * DAY, end);

      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);

      const a = await advertisers.getAdvertiser(deployco.address);
      expect(await resolver.text(node, "disclosed.domain")).to.equal("deployco.com");
      expect(await resolver.text(node, "disclosed.verified")).to.equal("true");
      expect(await resolver.text(node, "disclosed.tier")).to.equal("moderate");
      expect(await resolver.text(node, "disclosed.registered-at")).to.equal(a.registeredAt.toString());
      expect(await resolver.text(node, "disclosed.verified-at")).to.equal(a.verifiedAt.toString());
    });

    it("refuses an advertiser that has not proved domain control", async function () {
      const { subnames, admin, renderstack, outsider } = await loadFixture(deployFixture);

      await expect(subnames.connect(admin).issue("renderstack", renderstack.address))
        .to.be.revertedWithCustomError(subnames, "AdvertiserNotVerified")
        .withArgs(renderstack.address);

      await expect(
        subnames.connect(admin).issue("nobody", outsider.address),
      ).to.be.revertedWithCustomError(subnames, "AdvertiserNotVerified");
    });

    it("only an issuer may issue", async function () {
      const { subnames, outsider, deployco } = await loadFixture(deployFixture);

      await expect(
        subnames.connect(outsider).issue("deployco", deployco.address),
      ).to.be.revertedWithCustomError(subnames, "AccessControlUnauthorizedAccount");
    });

    it("gives an advertiser at most one name, and a label to at most one advertiser", async function () {
      const { subnames, advertisers, attestor, admin, deployco, renderstack } =
        await loadFixture(deployFixture);

      const node = await subnames.connect(admin).issue.staticCall("deployco", deployco.address);
      await subnames.connect(admin).issue("deployco", deployco.address);

      await expect(subnames.connect(admin).issue("deployco-two", deployco.address))
        .to.be.revertedWithCustomError(subnames, "AdvertiserAlreadyNamed")
        .withArgs(deployco.address, node);

      await advertisers.connect(attestor).setVerified(renderstack.address, true);
      await expect(subnames.connect(admin).issue("deployco", renderstack.address))
        .to.be.revertedWithCustomError(subnames, "LabelTaken")
        .withArgs("deployco");
    });

    it("rejects labels that could be used to impersonate", async function () {
      const { subnames, admin, deployco } = await loadFixture(deployFixture);

      for (const bad of ["ab", "DeployCo", "deploy co", "deploy.co", "-deployco", "deployco-", "déploy"]) {
        await expect(subnames.connect(admin).issue(bad, deployco.address)).to.be.revertedWithCustomError(
          subnames,
          "InvalidLabel",
        );
      }

      await expect(subnames.connect(admin).issue("deploy-co-2", deployco.address)).to.emit(
        subnames,
        "SubnameIssued",
      );
    });

    it("enumerates issued names", async function () {
      const { subnames, advertisers, attestor, admin, deployco, renderstack } =
        await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      await advertisers.connect(attestor).setVerified(renderstack.address, true);
      await subnames.connect(admin).issue("renderstack", renderstack.address);

      expect(await subnames.issuedCount()).to.equal(2n);
      expect(await subnames.issuedAt(0)).to.equal(ethers.namehash(`deployco.${PARENT}`));
      expect(await subnames.issuedAt(1)).to.equal(ethers.namehash(`renderstack.${PARENT}`));
    });
  });

  describe("records mirror on-chain truth", function () {
    it("anyone may refresh them", async function () {
      const { subnames, resolver, tiers, attestor, admin, deployco, outsider } =
        await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);
      expect(await resolver.text(node, "disclosed.tier")).to.equal("none");

      const end = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, end - 30 * DAY, end);

      await expect(subnames.connect(outsider).syncRecords(deployco.address))
        .to.emit(subnames, "RecordsSynced")
        .withArgs(node, deployco.address, true, BigInt(Tier.Major));

      expect(await resolver.text(node, "disclosed.tier")).to.equal("major");
    });

    it("follows a revocation without freeing the name", async function () {
      const { subnames, resolver, advertisers, attestor, admin, deployco } =
        await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);

      await advertisers.connect(attestor).setVerified(deployco.address, false);
      await subnames.syncRecords(deployco.address);

      expect(await resolver.text(node, "disclosed.verified")).to.equal("false");

      // The identity persists. This is the point: a caught advertiser does not
      // get to walk away from the name its history is attached to.
      expect(await subnames.nodeOf(deployco.address)).to.equal(node);
      expect(await subnames.advertiserOf(node)).to.equal(deployco.address);
      expect(await resolver.nodeOwner(node)).to.equal(deployco.address);
    });

    it("reports a tier that has gone stale as none", async function () {
      const { subnames, resolver, tiers, attestor, admin, deployco } = await loadFixture(deployFixture);

      const end = await time.latest();
      await tiers.connect(attestor).recordTier(deployco.address, Tier.Major, end - 30 * DAY, end);
      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);
      expect(await resolver.text(node, "disclosed.tier")).to.equal("major");

      await time.increase(VALIDITY + 1);
      await subnames.syncRecords(deployco.address);

      expect(await resolver.text(node, "disclosed.tier")).to.equal("none");
    });

    it("reverts for an advertiser with no name", async function () {
      const { subnames, outsider } = await loadFixture(deployFixture);

      await expect(subnames.syncRecords(outsider.address))
        .to.be.revertedWithCustomError(subnames, "NoSubname")
        .withArgs(outsider.address);
    });
  });

  describe("reputation is not resettable", function () {
    it("exposes no way to transfer, release or burn a name", async function () {
      const { subnames } = await loadFixture(deployFixture);

      const names = subnames.interface.fragments
        .filter((f): f is FunctionFragment => f.type === "function")
        .map((f) => f.name.toLowerCase());

      for (const escape of ["transfer", "release", "burn", "reset", "delete", "reassign", "renounce"]) {
        const found = names.filter((n) => n.includes(escape));
        // `renounceRole` is AccessControl's own, and gives up a role, not a name.
        expect(found, `found ${escape}`).to.deep.equal(escape === "renounce" ? ["renouncerole"] : []);
      }
    });

    it("keeps the advertiser bound to its name even while unverified", async function () {
      const { subnames, advertisers, attestor, admin, deployco } = await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      await advertisers.connect(attestor).setVerified(deployco.address, false);

      // No second identity, even after losing verification and re-earning it.
      await expect(
        subnames.connect(admin).issue("deployco-fresh", deployco.address),
      ).to.be.revertedWithCustomError(subnames, "AdvertiserNotVerified");

      await advertisers.connect(attestor).setVerified(deployco.address, true);
      await expect(
        subnames.connect(admin).issue("deployco-fresh", deployco.address),
      ).to.be.revertedWithCustomError(subnames, "AdvertiserAlreadyNamed");
    });
  });

  describe("delegation granted at issuance", function () {
    it("holds exactly the five reserved keys, and the advertiser holds none of them", async function () {
      const { subnames, resolver, admin, deployco } = await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);
      const registryAddress = await subnames.getAddress();

      const reserved = [
        "disclosed.verified",
        "disclosed.domain",
        "disclosed.registered-at",
        "disclosed.verified-at",
        "disclosed.tier",
      ];

      for (const key of reserved) {
        expect(await resolver.hasRecordRole(node, key, registryAddress), key).to.equal(true);
        expect(await resolver.canWrite(node, key, deployco.address), key).to.equal(false);
      }

      // Not a key it was not granted.
      expect(await resolver.hasRecordRole(node, "disclosed.anything-else", registryAddress)).to.equal(false);

      // And the advertiser still owns its ordinary profile.
      expect(await resolver.canWrite(node, "url", deployco.address)).to.equal(true);
      await resolver.connect(deployco).setText(node, "url", "https://deployco.com");
      expect(await resolver.text(node, "url")).to.equal("https://deployco.com");
    });

    it("can be revoked by the resolver admin without touching the name", async function () {
      const { subnames, resolver, admin, deployco } = await loadFixture(deployFixture);

      await subnames.connect(admin).issue("deployco", deployco.address);
      const node = await subnames.nodeOf(deployco.address);

      await resolver
        .connect(admin)
        .revokeRecordRole(node, "disclosed.tier", await subnames.getAddress());

      await expect(subnames.syncRecords(deployco.address)).to.be.revertedWithCustomError(
        resolver,
        "UnauthorizedRecordWrite",
      );

      expect(await resolver.nodeOwner(node)).to.equal(deployco.address);
      expect(await resolver.text(node, "disclosed.verified")).to.equal("true");
    });
  });
});
