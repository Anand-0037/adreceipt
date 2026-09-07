import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import {
  authorisationMessage,
  checkAuthorisation,
  isRecordable,
  normaliseDomain,
  SIGNATURE_TTL_SECONDS,
} from "./control";

const wallet = new Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const other = new Wallet(
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
);

const sign = (w: Wallet, address: string, domain: string, issuedAt: number) =>
  w.signMessage(authorisationMessage({ address, domain, issuedAt }));

const now = 1_700_000_000;

test("a wallet may authorise recording its own proof", async () => {
  const signature = await sign(wallet, wallet.address, "deployco.com", now);
  assert.equal(
    checkAuthorisation({
      address: wallet.address,
      domain: "deployco.com",
      issuedAt: now,
      signature,
      now,
    }).ok,
    true,
  );
});

test("one wallet cannot authorise a proof for another", async () => {
  // The attack the previous route allowed: acting on someone else's identity.
  const signature = await sign(other, wallet.address, "deployco.com", now);
  const result = checkAuthorisation({
    address: wallet.address,
    domain: "deployco.com",
    issuedAt: now,
    signature,
    now,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /different wallet/i);
});

test("a signature for one domain does not authorise another", async () => {
  const signature = await sign(wallet, wallet.address, "deployco.com", now);
  assert.equal(
    checkAuthorisation({
      address: wallet.address,
      domain: "hostfast.io",
      issuedAt: now,
      signature,
      now,
    }).ok,
    false,
  );
});

test("an old signature stops working", async () => {
  const signature = await sign(wallet, wallet.address, "deployco.com", now);
  const result = checkAuthorisation({
    address: wallet.address,
    domain: "deployco.com",
    issuedAt: now,
    signature,
    now: now + SIGNATURE_TTL_SECONDS + 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /expired/i);
});

test("a signature dated in the future is refused", async () => {
  const future = now + 3600;
  const signature = await sign(wallet, wallet.address, "deployco.com", future);
  assert.equal(
    checkAuthorisation({
      address: wallet.address,
      domain: "deployco.com",
      issuedAt: future,
      signature,
      now,
    }).ok,
    false,
  );
});

test("garbage signatures are refused rather than throwing", () => {
  const result = checkAuthorisation({
    address: wallet.address,
    domain: "deployco.com",
    issuedAt: now,
    signature: "0xnotasignature",
    now,
  });
  assert.equal(result.ok, false);
});

test("only a positive proof may be written on-chain", () => {
  // The rule that stops anyone revoking a legitimate advertiser by asking at a
  // bad moment. A false verdict revokes in the registry, so it must never be
  // produced automatically.
  assert.equal(isRecordable("controlled"), true);
  assert.equal(isRecordable("record-missing"), false);
  assert.equal(isRecordable("record-mismatch"), false);
  assert.equal(isRecordable("undetermined"), false);
  assert.equal(isRecordable("not-registered"), false);
});

test("domains are compared in one normalised form", () => {
  assert.equal(normaliseDomain("DeployCo.com"), "deployco.com");
  assert.equal(normaliseDomain("deployco.com."), "deployco.com");
  assert.equal(normaliseDomain("  DEPLOYCO.COM..  "), "deployco.com");
});

test("the signed message pins wallet and domain in normalised form", () => {
  const message = authorisationMessage({
    address: "0xAbC0000000000000000000000000000000000001",
    domain: "DeployCo.com.",
    issuedAt: now,
  });
  assert.match(message, /0xabc0000000000000000000000000000000000001/);
  assert.match(message, /deployco\.com$/m);
  // Someone should be able to read what they are approving in a wallet prompt.
  assert.match(message, /Signing costs nothing/);
});
