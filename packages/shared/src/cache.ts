export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  /** `ttlMs` overrides the constructor TTL for this entry (the gateway caps it by a token's `exp`). */
  set(key: string, value: V, ttlMs: number = this.ttlMs): void {
    this.entries.delete(key)
    if (ttlMs <= 0) return
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs })
  }
}
