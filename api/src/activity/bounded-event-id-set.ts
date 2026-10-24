export const ACTIVITY_EVENT_DEDUPLICATION_LIMIT = 4_096;

export class BoundedEventIdSet {
  readonly #limit: number;
  readonly #ids = new Set<string>();

  constructor(limit = ACTIVITY_EVENT_DEDUPLICATION_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Event ID retention limit must be a positive safe integer");
    }
    this.#limit = limit;
  }

  get size(): number {
    return this.#ids.size;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  add(id: string): void {
    if (this.#ids.has(id)) return;
    this.#ids.add(id);
    if (this.#ids.size > this.#limit) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
  }

  clear(): void {
    this.#ids.clear();
  }
}
