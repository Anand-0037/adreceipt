import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

enum Status {
  None,
  Pending,
  Verified,
  Revoked,
}

describe("AdvertiserRegistry", function () {
  async function deployFixture() {
    const [admin, attestor, deployco, impostor, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("AdvertiserRegistry", [admin.address, attestor.address]);
    await registry.waitForDeployment();

    return { registry, admin, attestor, deployco, impostor, outsider };
  }

  describe("deployment", function () {
    it("grants admin and attestor roles as constructed", async function () {
      const { registry, admin, attestor, outsider } = await loadFixture(deployFixture);

      const ADMIN = await registry.DEFAULT_ADMIN_ROLE();
      const ATTESTOR = await registry.ATTESTOR_ROLE();

      expect(await registry.hasRole(ADMIN, admin.address)).to.equal(true);
      expect(await registry.hasRole(ATTESTOR, attestor.address)).to.equal(true);
      expect(await registry.hasRole(ATTESTOR, outsider.address)).to.equal(false);
    });
  });

  describe("register", function () {
    it("creates a pending entry and issues a challenge", async function () {
      const { registry, deployco } = await loadFixture(deployFixture);

      await expect(registry.connect(deployco).register("DeployCo", "deployco.com"))
        .to.emit(registry, "AdvertiserRegistered")
        .and.to.emit(registry, "ChallengeIssued");

      const a = await registry.getAdvertiser(deployco.address);
      expect(a.name).to.equal("DeployCo");
      expect(a.domain).to.equal("deployco.com");
      expect(a.status).to.equal(BigInt(Status.Pending));
      expect(a.verifiedAt).to.equal(0n);
      expect(a.challenge).to.not.equal(ethers.ZeroHash);
      expect(await registry.isVerified(deployco.address)).to.equal(false);
    });

    it("tracks registration order for enumeration", async function () {
      const { registry, deployco, impostor } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(impostor).register("DeployCo", "deploy-co.net");

      expect(await registry.advertiserCount()).to.equal(2n);
      expect(await registry.advertiserAt(0)).to.equal(deployco.address);
      expect(await registry.advertiserAt(1)).to.equal(impostor.address);
    });

    it("issues distinct challenges to different claimants", async function () {
      const { registry, deployco, impostor } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(impostor).register("DeployCo", "deployco.com");

      expect(await registry.challengeOf(deployco.address)).to.not.equal(
        await registry.challengeOf(impostor.address),
      );
    });

    it("rejects a second registration from the same wallet", async function () {
      const { registry, deployco } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await expect(
        registry.connect(deployco).register("DeployCo", "deployco.com"),
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("rejects empty name or domain", async function () {
      const { registry, deployco } = await loadFixture(deployFixture);

      await expect(registry.connect(deployco).register("", "deployco.com")).to.be.revertedWithCustomError(
        registry,
        "EmptyName",
      );
      await expect(registry.connect(deployco).register("DeployCo", "")).to.be.revertedWithCustomError(
        registry,
        "EmptyDomain",
      );
    });
  });

  describe("setVerified", function () {
    it("marks an advertiser verified and records the ownership claims", async function () {
      const { registry, attestor, deployco } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");

      await expect(registry.connect(attestor).setVerified(deployco.address, true))
        .to.emit(registry, "AdvertiserVerified")
        .withArgs(
          deployco.address,
          true,
          await registry.canonicalHash("deployco"),
          await registry.canonicalHash("deployco.com"),
          anyValue,
        );

      expect(await registry.isVerified(deployco.address)).to.equal(true);
      expect(await registry.statusOf(deployco.address)).to.equal(BigInt(Status.Verified));
      expect(await registry.verifiedOwnerOfName("DeployCo")).to.equal(deployco.address);
      expect(await registry.verifiedOwnerOfDomain("deployco.com")).to.equal(deployco.address);
    });

    it("only the attestor may call it", async function () {
      const { registry, admin, outsider, deployco } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");

      await expect(
        registry.connect(outsider).setVerified(deployco.address, true),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");

      // Even the admin cannot attest without holding the role.
      await expect(
        registry.connect(admin).setVerified(deployco.address, true),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("reverts for an address that never registered", async function () {
      const { registry, attestor, outsider } = await loadFixture(deployFixture);

      await expect(
        registry.connect(attestor).setVerified(outsider.address, true),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("blocks an impostor from verifying a brand name already proved", async function () {
      const { registry, attestor, deployco, impostor } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(deployco.address, true);

      // The impostor controls a lookalike domain, so the DNS check passes for it -
      // but the brand name is already spoken for.
      await registry.connect(impostor).register("deployco", "deploy-co.net");
      await expect(registry.connect(attestor).setVerified(impostor.address, true))
        .to.be.revertedWithCustomError(registry, "NameClaimedByAnother")
        .withArgs(deployco.address);

      expect(await registry.isVerified(impostor.address)).to.equal(false);
    });

    it("blocks two wallets from verifying the same domain", async function () {
      const { registry, attestor, deployco, impostor } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(deployco.address, true);

      await registry.connect(impostor).register("DeployCo Cloud", "DeployCo.com");
      await expect(registry.connect(attestor).setVerified(impostor.address, true))
        .to.be.revertedWithCustomError(registry, "DomainClaimedByAnother")
        .withArgs(deployco.address);
    });

    it("is idempotent for the holder of the claim", async function () {
      const { registry, attestor, deployco } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(deployco.address, true);
      await expect(registry.connect(attestor).setVerified(deployco.address, true)).to.not.be.reverted;

      expect(await registry.isVerified(deployco.address)).to.equal(true);
    });

    it("revocation frees the name and domain for the rightful holder", async function () {
      const { registry, attestor, deployco, impostor } = await loadFixture(deployFixture);

      await registry.connect(impostor).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(impostor.address, true);

      await registry.connect(attestor).setVerified(impostor.address, false);
      expect(await registry.statusOf(impostor.address)).to.equal(BigInt(Status.Revoked));
      expect(await registry.verifiedOwnerOfName("DeployCo")).to.equal(ethers.ZeroAddress);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(deployco.address, true);
      expect(await registry.verifiedOwnerOfName("DeployCo")).to.equal(deployco.address);
    });
  });

  describe("updateClaim", function () {
    it("drops verification and issues a fresh challenge", async function () {
      const { registry, attestor, deployco } = await loadFixture(deployFixture);

      await registry.connect(deployco).register("DeployCo", "deployco.com");
      await registry.connect(attestor).setVerified(deployco.address, true);
      const oldChallenge = await registry.challengeOf(deployco.address);

      await expect(registry.connect(deployco).updateClaim("DeployCo", "deployco.io")).to.emit(
        registry,
        "ClaimUpdated",
      );

      expect(await registry.isVerified(deployco.address)).to.equal(false);
      expect(await registry.statusOf(deployco.address)).to.equal(BigInt(Status.Pending));
      expect(await registry.challengeOf(deployco.address)).to.not.equal(oldChallenge);
      expect(await registry.verifiedOwnerOfName("DeployCo")).to.equal(ethers.ZeroAddress);
      expect(await registry.verifiedOwnerOfDomain("deployco.com")).to.equal(ethers.ZeroAddress);
    });

    it("reverts for an unregistered caller", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);

      await expect(
        registry.connect(outsider).updateClaim("Whatever", "whatever.com"),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });
  });

  describe("canonicalHash", function () {
    it("is case-insensitive for ASCII", async function () {
      const { registry } = await loadFixture(deployFixture);

      expect(await registry.canonicalHash("DeployCo")).to.equal(await registry.canonicalHash("deployco"));
      expect(await registry.canonicalHash("DEPLOYCO.COM")).to.equal(
        await registry.canonicalHash("deployco.com"),
      );
      expect(await registry.canonicalHash("DeployCo")).to.not.equal(
        await registry.canonicalHash("HostFast"),
      );
    });
  });

  describe("registry-scoped answers", function () {
    it("returns the zero address for a company that never registered", async function () {
      const { registry } = await loadFixture(deployFixture);

      // "Not in registry" is the only claim this contract can make about HostFast.
      expect(await registry.verifiedOwnerOfName("HostFast")).to.equal(ethers.ZeroAddress);
      expect(await registry.verifiedOwnerOfDomain("hostfast.io")).to.equal(ethers.ZeroAddress);
    });
  });
});
