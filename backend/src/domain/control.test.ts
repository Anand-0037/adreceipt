import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import {
  authorisationMessage,
  DomainAuthorisationStore,
  isRecordable,
  normaliseDomain,
  SIGNATURE_TTL_SECONDS,
} from "./control";

const wallet = new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = new Wallet("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const challenge = `0x${"ab".repeat(32)}`;
const nonce = `0x${"cd".repeat(32)}`;
const now = 1_700_000_000;

function issue() {
  const store = new DomainAuthorisationStore(11155111, SIGNATURE_TTL_SECONDS, () => nonce);
  const authorisation = store.issue({
    address: wallet.address,
    domain: "DeployCo.com.",
    challenge,
    now,
  });
  return { store, authorisation };
}

test("a wallet may authorise its own current registry challenge once", async () => {
  const { store, authorisation } = issue();
  const signature = await wallet.signMessage(authorisationMessage(authorisation));
  assert.equal(store.consume({ ...authorisation, signature, now }).ok, true);
  const replay = store.consume({ ...authorisation, signature, now });
  assert.equal(replay.ok, false);
  assert.match(replay.reason ?? "", /already used/i);
});

test("an invalid signer cannot consume another wallet's request", async () => {
  const { store, authorisation } = issue();
  const wrongSignature = await other.signMessage(authorisationMessage(authorisation));
  assert.equal(store.consume({ ...authorisation, signature: wrongSignature, now }).ok, false);

  const validSignature = await wallet.signMessage(authorisationMessage(authorisation));
  assert.equal(store.consume({ ...authorisation, signature: validSignature, now }).ok, true);
});

test("altering domain, chain, challenge, expiry, or nonce is rejected", async () => {
  for (const change of [
    { domain: "hostfast.io" },
    { chainId: 1 },
    { challenge: `0x${"ee".repeat(32)}` },
    { expiresAt: now + 999 },
    { nonce: `0x${"ff".repeat(32)}` },
  ]) {
    const { store, authorisation } = issue();
    const signature = await wallet.signMessage(authorisationMessage(authorisation));
    assert.equal(store.consume({ ...authorisation, ...change, signature, now }).ok, false);
  }
});

test("an expired authorisation cannot be consumed", async () => {
  const { store, authorisation } = issue();
  const signature = await wallet.signMessage(authorisationMessage(authorisation));
  assert.equal(
    store.consume({
      ...authorisation,
      signature,
      now: now + SIGNATURE_TTL_SECONDS + 1,
    }).ok,
    false,
  );
});

test("domains are normalized before storage and signing", () => {
  const { authorisation } = issue();
  assert.equal(authorisation.domain, "deployco.com");
  assert.equal(normaliseDomain("  DEPLOYCO.COM..  "), "deployco.com");
  const message = authorisationMessage(authorisation);
  assert.match(message, /Chain ID: 11155111/);
  assert.match(message, /Registry challenge: 0xabab/);
  assert.match(message, /Request nonce: 0xcdcd/);
  assert.match(message, /Signing costs nothing/);
});

test("only a positive proof may be written on-chain", () => {
  assert.equal(isRecordable("controlled"), true);
  assert.equal(isRecordable("record-missing"), false);
  assert.equal(isRecordable("record-mismatch"), false);
  assert.equal(isRecordable("undetermined"), false);
  assert.equal(isRecordable("not-registered"), false);
});
