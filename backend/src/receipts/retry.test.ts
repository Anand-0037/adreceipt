import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReadSingleFlight, retryRead } from "./retry";

describe("retryRead", () => {
  it("returns immediately after a successful read", async () => {
    let calls = 0;
    const value = await retryRead(async () => {
      calls += 1;
      return "fresh evidence";
    });
    assert.equal(value, "fresh evidence");
    assert.equal(calls, 1);
  });

  it("retries one transient failure", async () => {
    let calls = 0;
    const waits: number[] = [];
    const value = await retryRead(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary provider failure");
        return "fresh evidence";
      },
      { wait: async (milliseconds) => void waits.push(milliseconds) },
    );
    assert.equal(value, "fresh evidence");
    assert.equal(calls, 2);
    assert.deepEqual(waits, [200]);
  });

  it("fails after the bounded number of attempts", async () => {
    let calls = 0;
    await assert.rejects(
      retryRead(
        async () => {
          calls += 1;
          throw new Error("provider unavailable");
        },
        { attempts: 2, delayMs: 0, wait: async () => undefined },
      ),
      /provider unavailable/,
    );
    assert.equal(calls, 2);
  });
});

describe("ReadSingleFlight", () => {
  it("shares concurrent reads but does not cache completed evidence", async () => {
    const reads = new ReadSingleFlight();
    let calls = 0;
    let release: (() => void) | undefined;
    const operation = async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return calls;
    };

    const first = reads.run("ledger", operation);
    const second = reads.run("ledger", operation);
    assert.equal(calls, 1);
    release?.();
    assert.equal(await first, 1);
    assert.equal(await second, 1);

    const next = reads.run("ledger", async () => {
      calls += 1;
      return calls;
    });
    assert.equal(await next, 2);
  });
});
