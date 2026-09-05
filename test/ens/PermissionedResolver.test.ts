import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const NODE = ethers.namehash("deployco.disclosed.eth");
const OTHER_NODE = ethers.namehash("renderstack.disclosed.eth");

describe("PermissionedResolver", function () {
  async function deployFixture() {
    const [admin, controller, deployco, oracle, outsider] = await ethers.getSigners();

    const resolver = await ethers.deployContract("PermissionedResolver", [admin.address, controller.address]);
    await resolver.waitForDeployment();

    await resolver.connect(controller).initializeNode(NODE, deployco.address);

    return { resolver, admin, controller, deployco, oracle, outsider };
  }

  describe("node lifecycle", function () {
    it("binds a node to its owner and seeds the address record", async function () {
      const { resolver, deployco } = await loadFixture(deployFixture);

      expect(await resolver.nodeOwner(NODE)).to.equal(deployco.address);
      expect(await resolver.addr(NODE)).to.equal(deployco.address);
    });

    it("only the controller may create nodes, and only once", async function () {
      const { resolver, controller, deployco, outsider } = await loadFixture(deployFixture);

      await expect(
        resolver.connect(outsider).initializeNode(OTHER_NODE, outsider.address),
      ).to.be.revertedWithCustomError(resolver, "AccessControlUnauthorizedAccount");

      await expect(resolver.connect(controller).initializeNode(NODE, deployco.address))
        .to.be.revertedWithCustomError(resolver, "NodeAlreadyInitialized")
        .withArgs(NODE);

      await expect(
        resolver.connect(controller).initializeNode(OTHER_NODE, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(resolver, "ZeroOwner");
    });

    it("rejects writes to a node that was never created", async function () {
      const { resolver, deployco } = await loadFixture(deployFixture);

      await expect(resolver.connect(deployco).setText(OTHER_NODE, "url", "https://x.com"))
        .to.be.revertedWithCustomError(resolver, "UnknownNode")
        .withArgs(OTHER_NODE);
    });
  });

  describe("ordinary profile records belong to the owner", function () {
    it("lets the owner write and read them", async function () {
      const { resolver, deployco } = await loadFixture(deployFixture);

      await expect(resolver.connect(deployco).setText(NODE, "url", "https://deployco.com"))
        .to.emit(resolver, "TextChanged")
        // `string indexed` arrives as a hash; the unindexed copy carries the value.
        .withArgs(NODE, anyValue, "url", "https://deployco.com");

      expect(await resolver.text(NODE, "url")).to.equal("https://deployco.com");
      expect(await resolver.canWrite(NODE, "url", deployco.address)).to.equal(true);
    });

    it("keeps strangers out", async function () {
      const { resolver, outsider } = await loadFixture(deployFixture);

      await expect(resolver.connect(outsider).setText(NODE, "url", "https://evil.example"))
        .to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite")
        .withArgs(NODE, "url", outsider.address);
    });

    it("lets the owner delegate a single ordinary key and take it back", async function () {
      const { resolver, deployco, outsider } = await loadFixture(deployFixture);

      await expect(resolver.connect(deployco).grantRecordRole(NODE, "description", outsider.address))
        .to.emit(resolver, "RecordRoleGranted")
        .withArgs(NODE, "description", outsider.address);

      await resolver.connect(outsider).setText(NODE, "description", "Managed by an agency");
      expect(await resolver.text(NODE, "description")).to.equal("Managed by an agency");

      // The delegation is that key and no other.
      await expect(
        resolver.connect(outsider).setText(NODE, "url", "https://evil.example"),
      ).to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite");

      await resolver.connect(deployco).revokeRecordRole(NODE, "description", outsider.address);
      await expect(
        resolver.connect(outsider).setText(NODE, "description", "again"),
      ).to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite");
    });

    it("only the owner sets the address record", async function () {
      const { resolver, deployco, outsider } = await loadFixture(deployFixture);

      await expect(resolver.connect(deployco).setAddr(NODE, outsider.address))
        .to.emit(resolver, "AddrChanged")
        .withArgs(NODE, outsider.address);
      expect(await resolver.addr(NODE)).to.equal(outsider.address);

      await expect(resolver.connect(outsider).setAddr(NODE, outsider.address))
        .to.be.revertedWithCustomError(resolver, "NotNodeOwner")
        .withArgs(outsider.address, deployco.address);
    });
  });

  describe("reserved records do not belong to the owner", function () {
    it("recognises the reserved prefix", async function () {
      const { resolver } = await loadFixture(deployFixture);

      expect(await resolver.isReservedKey("disclosed.verified")).to.equal(true);
      expect(await resolver.isReservedKey("disclosed.tier")).to.equal(true);
      expect(await resolver.isReservedKey("url")).to.equal(false);
      expect(await resolver.isReservedKey("disclosed")).to.equal(false); // shorter than the prefix
      expect(await resolver.isReservedKey("undisclosed.verified")).to.equal(false);
    });

    it("stops the name's owner writing its own verification status", async function () {
      const { resolver, deployco } = await loadFixture(deployFixture);

      // This is the attack the whole design exists to stop: an advertiser
      // marking itself verified on a name it legitimately owns.
      await expect(resolver.connect(deployco).setText(NODE, "disclosed.verified", "true"))
        .to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite")
        .withArgs(NODE, "disclosed.verified", deployco.address);

      expect(await resolver.canWrite(NODE, "disclosed.verified", deployco.address)).to.equal(false);
      expect(await resolver.text(NODE, "disclosed.verified")).to.equal("");
    });

    it("stops the owner delegating a reserved key to itself or anyone else", async function () {
      const { resolver, deployco, outsider } = await loadFixture(deployFixture);

      await expect(resolver.connect(deployco).grantRecordRole(NODE, "disclosed.verified", deployco.address))
        .to.be.revertedWithCustomError(resolver, "ReservedKey")
        .withArgs("disclosed.verified");

      await expect(
        resolver.connect(outsider).grantRecordRole(NODE, "disclosed.tier", outsider.address),
      ).to.be.revertedWithCustomError(resolver, "ReservedKey");
    });

    it("lets the controller delegate one reserved key, narrowly", async function () {
      const { resolver, controller, oracle } = await loadFixture(deployFixture);

      await resolver.connect(controller).grantRecordRole(NODE, "disclosed.verified", oracle.address);

      await resolver.connect(oracle).setText(NODE, "disclosed.verified", "true");
      expect(await resolver.text(NODE, "disclosed.verified")).to.equal("true");

      // One record on one name. Not the tier, and not the same key elsewhere.
      await expect(
        resolver.connect(oracle).setText(NODE, "disclosed.tier", "major"),
      ).to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite");

      await resolver.connect(controller).initializeNode(OTHER_NODE, oracle.address);
      await expect(
        resolver.connect(oracle).setText(OTHER_NODE, "disclosed.verified", "true"),
      ).to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite");
    });

    it("revokes a reserved delegation in a single transaction", async function () {
      const { resolver, controller, oracle } = await loadFixture(deployFixture);

      await resolver.connect(controller).grantRecordRole(NODE, "disclosed.verified", oracle.address);
      await resolver.connect(oracle).setText(NODE, "disclosed.verified", "true");

      await expect(resolver.connect(controller).revokeRecordRole(NODE, "disclosed.verified", oracle.address))
        .to.emit(resolver, "RecordRoleRevoked")
        .withArgs(NODE, "disclosed.verified", oracle.address);

      expect(await resolver.hasRecordRole(NODE, "disclosed.verified", oracle.address)).to.equal(false);
      await expect(
        resolver.connect(oracle).setText(NODE, "disclosed.verified", "false"),
      ).to.be.revertedWithCustomError(resolver, "UnauthorizedRecordWrite");

      // The last written value stands; revocation stops future writes, it does
      // not rewrite history.
      expect(await resolver.text(NODE, "disclosed.verified")).to.equal("true");
    });

    it("lets the resolver admin act as a delegation administrator too", async function () {
      const { resolver, admin, oracle } = await loadFixture(deployFixture);

      await resolver.connect(admin).grantRecordRole(NODE, "disclosed.tier", oracle.address);
      await resolver.connect(oracle).setText(NODE, "disclosed.tier", "moderate");
      expect(await resolver.text(NODE, "disclosed.tier")).to.equal("moderate");
    });
  });

  describe("ERC-165", function () {
    it("announces the ENS addr and text profiles", async function () {
      const { resolver } = await loadFixture(deployFixture);

      expect(await resolver.supportsInterface("0x3b3b57de")).to.equal(true); // IAddrResolver
      expect(await resolver.supportsInterface("0x59d1d43c")).to.equal(true); // ITextResolver
      expect(await resolver.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
      expect(await resolver.supportsInterface("0xdeadbeef")).to.equal(false);
    });
  });
});
