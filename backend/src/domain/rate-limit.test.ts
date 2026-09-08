import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "./rate-limit";

test("limits one caller and resets after the window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.equal(limiter.allow("caller", 0), true);
  assert.equal(limiter.allow("caller", 1), true);
  assert.equal(limiter.allow("caller", 2), false);
  assert.equal(limiter.allow("other", 2), true);
  assert.equal(limiter.allow("caller", 1_000), true);
});
