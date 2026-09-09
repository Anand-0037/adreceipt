export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return true;
    }
    if (current.count >= this.maximum) return false;
    current.count += 1;
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size < 1_000) return;
    for (const [key, value] of this.windows) {
      if (now - value.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
