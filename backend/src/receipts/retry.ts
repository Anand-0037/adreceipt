export interface ReadRetryOptions {
  attempts?: number;
  delayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry a provider-backed read once before failing closed. No result is cached
 * or inferred: every attempt must return fresh Graph/RPC evidence.
 */
export async function retryRead<T>(
  operation: () => Promise<T>,
  options: ReadRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 200;
  const wait = options.wait ?? sleep;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("Read retry attempts must be a positive integer");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw lastError;
}

/** Share one in-progress provider read for an identical key, without caching it. */
export class ReadSingleFlight {
  private readonly reads = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.reads.get(key);
    if (existing) return existing as Promise<T>;

    const read = operation().finally(() => {
      if (this.reads.get(key) === read) this.reads.delete(key);
    });
    this.reads.set(key, read);
    return read;
  }
}
