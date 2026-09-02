import type { Event } from "nostr-tools/pure";
import { createClient, type RedisClientType } from "redis";
import type { ActivityQuery, ActivityQueryResult } from "@/activity/activity-relay";

const APPLY_PROJECTION = `
local added = redis.call("SADD", KEYS[1], ARGV[1])
if added == 1 then
  redis.call("HINCRBY", KEYS[2], ARGV[2], 1)
end
return added
`;

interface ActivityHistory {
  query(input: ActivityQuery): Promise<ActivityQueryResult>;
}

function tagValue(event: Event, name: string): string | undefined {
  return event.tags.find(([tag, value]) => tag === name && value)?.[1];
}

export class ActivityProjection {
  readonly #redis: RedisClientType;

  private constructor(redis: RedisClientType) {
    this.#redis = redis;
  }

  static async connect(redisUrl: string): Promise<ActivityProjection> {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    return new ActivityProjection(redis);
  }

  async replay(
    history: ActivityHistory,
    input: ActivityQuery,
  ): Promise<{ seen: number; applied: number }> {
    let cursor: string | null = null;
    let seen = 0;
    let applied = 0;

    do {
      const page = await history.query({ ...input, cursor, limit: 100 });
      seen += page.events.length;
      for (const event of page.events) {
        const source = tagValue(event, "s");
        const actor = tagValue(event, "n");
        const eventType = tagValue(event, "t");
        const idempotencyKey = tagValue(event, "i");
        if (!source || !actor || !eventType || !idempotencyKey) continue;
        const result = await this.#redis.eval(APPLY_PROJECTION, {
          keys: ["activity:projection:idempotency", `activity:projection:counts:${actor}`],
          arguments: [
            JSON.stringify([source, idempotencyKey]),
            JSON.stringify([source, eventType]),
          ],
        });
        applied += Number(result);
      }
      cursor = page.nextCursor;
    } while (cursor);

    return { seen, applied };
  }

  async getCount(input: { source: string; actor: string; eventType: string }): Promise<number> {
    const count = await this.#redis.hGet(
      `activity:projection:counts:${input.actor}`,
      JSON.stringify([input.source, input.eventType]),
    );
    return Number(count ?? 0);
  }

  async close(): Promise<void> {
    if (this.#redis.isOpen) await this.#redis.quit();
  }
}
