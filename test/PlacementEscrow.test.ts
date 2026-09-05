import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { FunctionFragment } from "ethers";

const DAY = 24 * 60 * 60;
const LOCK = 7 * DAY;
const MIN_PLACEMENT = ethers.parseEther("0.001");

describe("PlacementEscrow", function () {
  async function deployFixture() {
    const [admin, attestor, deployco, renderstack, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("AdvertiserRegistry", [admin.address, attestor.address]);
    await registry.waitForDeployment();

    const escrow = await ethers.deployContract("PlacementEscrow", [
      admin.address,
      await registry.getAddress(),
      LOCK,
      MIN_PLACEMENT,
    ]);
    await escrow.waitForDeployment();

    // DeployCo completes the full identity flow; RenderStack registers but is
    // never attested; outsider never touches the registry at all.
    await registry.connect(deployco).register("DeployCo", "deployco.com");
    await registry.connect(attestor).setVerified(deployco.address, true);
    await registry.connect(renderstack).register("RenderStack", "renderstack.com");

    return { registry, escrow, admin, attestor, deployco, renderstack, outsider };
  }

  describe("deployment", function () {
    it("stores its parameters and grants the operator role to the admin", async function () {
      const { registry, escrow, admin } = await loadFixture(deployFixture);

      expect(await escrow.registry()).to.equal(await registry.getAddress());
      expect(await escrow.lockDuration()).to.equal(BigInt(LOCK));
      expect(await escrow.minPlacement()).to.equal(MIN_PLACEMENT);
      expect(await escrow.hasRole(await escrow.OPERATOR_ROLE(), admin.address)).to.equal(true);
    });

    it("refuses a lock longer than the hard cap", async function () {
      const { registry, admin } = await loadFixture(deployFixture);

      const Escrow = await ethers.getContractFactory("PlacementEscrow");
      const tooLong = 31 * DAY;
      await expect(
        Escrow.deploy(admin.address, await registry.getAddress(), tooLong, MIN_PLACEMENT),
      ).to.be.revertedWithCustomError(Escrow, "LockTooLong");
    });
  });

  describe("createPlacement", function () {
    it("escrows the deposit and records it against the category", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1");
      await expect(escrow.connect(deployco).createPlacement("backend hosting", { value: amount }))
        .to.emit(escrow, "PlacementCreated")
        .withArgs(
          0n,
          deployco.address,
          await escrow.categoryHashOf("backend hosting"),
          "backend hosting",
          amount,
          anyValue,
          anyValue,
        );

      const p = await escrow.getPlacement(0);
      expect(p.advertiser).to.equal(deployco.address);
      expect(p.amount).to.equal(amount);
      expect(p.withdrawn).to.equal(false);
      expect(p.unlockAt - p.createdAt).to.equal(BigInt(LOCK));

      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount);
      expect(await escrow.escrowedBalance(deployco.address)).to.equal(amount);
      expect(await escrow.lifetimeDeposited(deployco.address)).to.equal(amount);
      expect(await escrow.placementCount(deployco.address)).to.equal(1n);
      expect(await escrow.categoryLifetime("backend hosting")).to.equal(amount);
    });

    it("treats categories case-insensitively", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("Backend Hosting", { value: ethers.parseEther("1") });
      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("2") });

      expect(await escrow.categoryLifetime("BACKEND HOSTING")).to.equal(ethers.parseEther("3"));
      expect(await escrow.placementsInCategory("backend hosting")).to.deep.equal([0n, 1n]);
    });

    it("rejects an advertiser that has registered but is not yet verified", async function () {
      const { escrow, renderstack } = await loadFixture(deployFixture);

      await expect(
        escrow.connect(renderstack).createPlacement("backend hosting", { value: ethers.parseEther("1") }),
      )
        .to.be.revertedWithCustomError(escrow, "AdvertiserNotVerified")
        .withArgs(renderstack.address);
    });

    it("rejects an advertiser that is not in the registry at all", async function () {
      const { escrow, outsider } = await loadFixture(deployFixture);

      await expect(
        escrow.connect(outsider).createPlacement("backend hosting", { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "AdvertiserNotVerified");
    });

    it("stops accepting money the moment verification is revoked", async function () {
      const { escrow, registry, attestor, deployco } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") });
      await registry.connect(attestor).setVerified(deployco.address, false);

      await expect(
        escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "AdvertiserNotVerified");
    });

    it("rejects dust and empty categories", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await expect(escrow.connect(deployco).createPlacement("backend hosting", { value: 1n }))
        .to.be.revertedWithCustomError(escrow, "DepositTooSmall")
        .withArgs(1n, MIN_PLACEMENT);

      await expect(
        escrow.connect(deployco).createPlacement("", { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "EmptyCategory");
    });
  });

  describe("withdrawPlacement", function () {
    it("returns the deposit once the lock elapses", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1");
      await escrow.connect(deployco).createPlacement("backend hosting", { value: amount });
      await time.increase(LOCK);

      await expect(escrow.connect(deployco).withdrawPlacement(0)).to.changeEtherBalance(deployco, amount);

      expect((await escrow.getPlacement(0)).withdrawn).to.equal(true);
      expect(await escrow.escrowedBalance(deployco.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("does not erase spend history - lifetime and count survive the withdrawal", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1");
      await escrow.connect(deployco).createPlacement("backend hosting", { value: amount });
      await time.increase(LOCK);
      await escrow.connect(deployco).withdrawPlacement(0);

      expect(await escrow.lifetimeDeposited(deployco.address)).to.equal(amount);
      expect(await escrow.placementCount(deployco.address)).to.equal(1n);
    });

    it("blocks a same-block flash-fund and withdraw", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("5") });
      await expect(escrow.connect(deployco).withdrawPlacement(0)).to.be.revertedWithCustomError(
        escrow,
        "StillLocked",
      );
    });

    it("only the depositor can withdraw", async function () {
      const { escrow, deployco, outsider } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") });
      await time.increase(LOCK);

      await expect(escrow.connect(outsider).withdrawPlacement(0))
        .to.be.revertedWithCustomError(escrow, "NotPlacementOwner")
        .withArgs(outsider.address, deployco.address);
    });

    it("cannot be withdrawn twice", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") });
      await time.increase(LOCK);
      await escrow.connect(deployco).withdrawPlacement(0);

      await expect(escrow.connect(deployco).withdrawPlacement(0))
        .to.be.revertedWithCustomError(escrow, "AlreadyWithdrawn")
        .withArgs(0n);
    });

    it("reverts on an unknown id", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await expect(escrow.connect(deployco).withdrawPlacement(99))
        .to.be.revertedWithCustomError(escrow, "UnknownPlacement")
        .withArgs(99n);
    });

    it("stays withdrawable while new placements are paused", async function () {
      const { escrow, admin, deployco } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1");
      await escrow.connect(deployco).createPlacement("backend hosting", { value: amount });
      await escrow.connect(admin).pause();
      await time.increase(LOCK);

      await expect(escrow.connect(deployco).withdrawPlacement(0)).to.changeEtherBalance(deployco, amount);
    });

    it("resists re-entrancy from a malicious advertiser contract", async function () {
      const { registry, escrow, attestor } = await loadFixture(deployFixture);

      const attacker = await ethers.deployContract("ReentrantAdvertiser", [
        await registry.getAddress(),
        await escrow.getAddress(),
      ]);
      await attacker.waitForDeployment();

      await attacker.register("HostFast", "hostfast.io");
      await registry.connect(attestor).setVerified(await attacker.getAddress(), true);

      const amount = ethers.parseEther("2");
      await attacker.fund("backend hosting", { value: amount });
      await time.increase(LOCK);

      // The outer withdrawal succeeds and pays exactly once; the nested call reverts.
      await expect(attacker.attack()).to.changeEtherBalance(attacker, amount);
      expect(await attacker.reentered()).to.equal(true);
      expect(await attacker.reentryReverted()).to.equal(true);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });
  });

  describe("cumulative accounting for tier computation", function () {
    it("sums ten split placements to the same total as one large one", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      for (let i = 0; i < 10; i++) {
        await escrow.connect(deployco).createPlacement("backend hosting", {
          value: ethers.parseEther("0.5"),
        });
      }

      expect(await escrow.lifetimeDeposited(deployco.address)).to.equal(ethers.parseEther("5"));
      expect(await escrow.placementCount(deployco.address)).to.equal(10n);
    });

    it("depositedSince only counts the rolling window", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") });
      await time.increase(30 * DAY);

      const cutoff = BigInt(await time.latest());
      await escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("4") });

      expect(await escrow.lifetimeDeposited(deployco.address)).to.equal(ethers.parseEther("5"));
      expect(await escrow.depositedSince(deployco.address, cutoff)).to.equal(ethers.parseEther("4"));
      expect(await escrow.depositedSince(deployco.address, 0)).to.equal(ethers.parseEther("5"));
    });

    it("returns zero for an advertiser with no placements", async function () {
      const { escrow, outsider } = await loadFixture(deployFixture);

      expect(await escrow.depositedSince(outsider.address, 0)).to.equal(0n);
      expect(await escrow.lifetimeDeposited(outsider.address)).to.equal(0n);
    });
  });

  describe("non-custodial guarantees", function () {
    it("exposes no way for the admin to move escrowed funds", async function () {
      const { escrow } = await loadFixture(deployFixture);

      const names = escrow.interface.fragments
        .filter((f): f is FunctionFragment => f.type === "function")
        .map((f) => f.name.toLowerCase());

      // The only value-moving entry point in the whole ABI is the advertiser's own reclaim.
      expect(names.filter((n) => n.includes("withdraw"))).to.deep.equal(["withdrawplacement"]);
      for (const forbidden of ["sweep", "rescue", "transfer", "collect", "settle", "drain"]) {
        expect(names.filter((n) => n.includes(forbidden))).to.deep.equal([]);
      }
    });

    it("rejects value sent directly to the contract", async function () {
      const { escrow, deployco } = await loadFixture(deployFixture);

      await expect(
        deployco.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "DirectPaymentRejected");
    });
  });

  describe("operator knobs", function () {
    it("lets the operator retune the lock and the minimum, within the cap", async function () {
      const { escrow, admin } = await loadFixture(deployFixture);

      await expect(escrow.connect(admin).setLockDuration(DAY))
        .to.emit(escrow, "LockDurationUpdated")
        .withArgs(BigInt(LOCK), BigInt(DAY));
      expect(await escrow.lockDuration()).to.equal(BigInt(DAY));

      await expect(escrow.connect(admin).setLockDuration(31 * DAY)).to.be.revertedWithCustomError(
        escrow,
        "LockTooLong",
      );

      await escrow.connect(admin).setMinPlacement(ethers.parseEther("0.01"));
      expect(await escrow.minPlacement()).to.equal(ethers.parseEther("0.01"));
    });

    it("keeps the knobs away from non-operators", async function () {
      const { escrow, outsider } = await loadFixture(deployFixture);

      await expect(escrow.connect(outsider).setLockDuration(DAY)).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await expect(escrow.connect(outsider).pause()).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("pausing halts new placements and unpausing restores them", async function () {
      const { escrow, admin, deployco } = await loadFixture(deployFixture);

      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await escrow.connect(admin).unpause();
      await expect(
        escrow.connect(deployco).createPlacement("backend hosting", { value: ethers.parseEther("1") }),
      ).to.emit(escrow, "PlacementCreated");
    });
  });
});
