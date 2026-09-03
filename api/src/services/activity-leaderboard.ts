import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { createClient, type RedisClientType } from "redis";
import type { Database } from "../db";
import {
  activityEventTypes as eventTypesTable,
  activitySources as sourcesTable,
} from "../db/schema";

export type ActivityLeaderboardPeriod = "weekly" | "monthly" | "all-time";

export type ActivityPointValue = {
  source: string;
  type: string;
  pointValue: number;
};

export type ActivityLeaderboardEvent = {
  id: string;
  source: string;
  type: string;
  actor: string;
  timestamp: string;
};

export type ActivityLeaderboardUpdate = {
  operation: "include" | "exclude";
  event: ActivityLeaderboardEvent;
};

export type ActivityLeaderboardBreakdown = {
  source: string;
  type: string;
  pointValue: number;
  eventCount: number;
  score: number;
};

export type ActivityLeaderboardEntry = {
  rank: number;
  actor: string;
  score: number;
  eventCount: number;
  breakdown: ActivityLeaderboardBreakdown[];
};

export type ActivityLeaderboardResult = {
  period: ActivityLeaderboardPeriod;
  startsAt: string | null;
  endsAt: string | null;
  generatedAt: string;
  projection: ActivityLeaderboardStatus;
  data: ActivityLeaderboardEntry[];
};

export type ActivityLeaderboardStatus = {
  state: "uninitialized" | "rebuilding" | "ready" | "failed";
  rebuiltAt: string | null;
  seen: number;
  applied: number;
  hidden: number;
};

export interface ActivityPointValueProvider {
  listPointValues(): Promise<ActivityPointValue[]>;
}

export class DatabaseActivityPointValueProvider implements ActivityPointValueProvider {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  listPointValues(): Promise<ActivityPointValue[]> {
    return this.#db
      .select({
        source: sourcesTable.sourceId,
        type: eventTypesTable.name,
        pointValue: eventTypesTable.pointValue,
      })
      .from(eventTypesTable)
      .innerJoin(sourcesTable, eq(eventTypesTable.sourceRecordId, sourcesTable.id));
  }
}

type ActivityDimension = ActivityPointValue;

type ActivityBucket = {
  id: string;
  expiresAt: number | null;
};

interface ActivityLeaderboardProjection {
  apply(update: ActivityLeaderboardUpdate, buckets: ActivityBucket[]): Promise<boolean>;
  listDimensions(bucket: string): Promise<Array<{ source: string; type: string }>>;
  rank(
    bucket: string,
    dimensions: ActivityDimension[],
    limit: number,
  ): Promise<ActivityLeaderboardEntry[]>;
  reset(): Promise<void>;
  getStatus(): Promise<ActivityLeaderboardStatus>;
  setStatus(status: ActivityLeaderboardStatus): Promise<void>;
  close(): Promise<void>;
}

type StoredEvent = {
  state: "included" | "excluded";
  event: ActivityLeaderboardEvent;
};

class InMemoryActivityLeaderboardProjection implements ActivityLeaderboardProjection {
  readonly #events = new Map<string, StoredEvent>();
  readonly #counts = new Map<string, Map<string, Map<string, number>>>();
  #status: ActivityLeaderboardStatus = emptyStatus("ready");

  async apply(update: ActivityLeaderboardUpdate, buckets: ActivityBucket[]): Promise<boolean> {
    const current = this.#events.get(update.event.id);
    if (update.operation === "include") {
      if (current) return false;
      this.#events.set(update.event.id, { state: "included", event: update.event });
      this.#adjust(update.event, buckets, 1);
      return true;
    }
    if (current?.state === "excluded") return false;
    this.#events.set(update.event.id, { state: "excluded", event: update.event });
    if (current?.state !== "included") return false;
    this.#adjust(update.event, buckets, -1);
    return true;
  }

  async listDimensions(bucket: string): Promise<Array<{ source: string; type: string }>> {
    return [...(this.#counts.get(bucket)?.keys() ?? [])].map(parseDimensionKey);
  }

  async rank(
    bucket: string,
    dimensions: ActivityDimension[],
    limit: number,
  ): Promise<ActivityLeaderboardEntry[]> {
    const bucketCounts = this.#counts.get(bucket);
    const actors = new Map<string, ActivityLeaderboardBreakdown[]>();
    for (const dimension of dimensions) {
      const counts = bucketCounts?.get(dimensionKey(dimension.source, dimension.type));
      for (const [actor, eventCount] of counts ?? []) {
        if (eventCount <= 0) continue;
        const breakdown = actors.get(actor) ?? [];
        breakdown.push({
          ...dimension,
          eventCount,
          score: eventCount * dimension.pointValue,
        });
        actors.set(actor, breakdown);
      }
    }
    return rankEntries(actors, limit);
  }

  async close(): Promise<void> {}

  async reset(): Promise<void> {
    this.#events.clear();
    this.#counts.clear();
    this.#status = emptyStatus("uninitialized");
  }

  async getStatus(): Promise<ActivityLeaderboardStatus> {
    return this.#status;
  }

  async setStatus(status: ActivityLeaderboardStatus): Promise<void> {
    this.#status = status;
  }

  #adjust(event: ActivityLeaderboardEvent, buckets: ActivityBucket[], change: number): void {
    const dimension = dimensionKey(event.source, event.type);
    for (const bucket of buckets) {
      const dimensions = this.#counts.get(bucket.id) ?? new Map<string, Map<string, number>>();
      const actors = dimensions.get(dimension) ?? new Map<string, number>();
      const count = (actors.get(event.actor) ?? 0) + change;
      if (count > 0) actors.set(event.actor, count);
      else actors.delete(event.actor);
      dimensions.set(dimension, actors);
      this.#counts.set(bucket.id, dimensions);
    }
  }
}

const APPLY_EVENT = `
local current = redis.call("HGET", KEYS[1], ARGV[1])
if current then
  return 0
end
redis.call("HSET", KEYS[1], ARGV[1], "included")
for index = 2, #KEYS, 2 do
  redis.call("ZINCRBY", KEYS[index], 1, ARGV[2])
  redis.call("SADD", KEYS[index + 1], ARGV[3])
  local expiresAt = tonumber(ARGV[3 + (index / 2)])
  if expiresAt and expiresAt > 0 then
    redis.call("EXPIREAT", KEYS[index], expiresAt)
    redis.call("EXPIREAT", KEYS[index + 1], expiresAt)
  end
end
return 1
`;

const EXCLUDE_EVENT = `
local current = redis.call("HGET", KEYS[1], ARGV[1])
if current == "excluded" then
  return 0
end
redis.call("HSET", KEYS[1], ARGV[1], "excluded")
if current ~= "included" then
  return 0
end
for index = 2, #KEYS, 2 do
  local count = redis.call("ZINCRBY", KEYS[index], -1, ARGV[2])
  if tonumber(count) <= 0 then
    redis.call("ZREM", KEYS[index], ARGV[2])
  end
end
return 1
`;

class RedisActivityLeaderboardProjection implements ActivityLeaderboardProjection {
  readonly #redis: RedisClientType;
  readonly #namespace: string;

  constructor(redis: RedisClientType, namespace: string) {
    this.#redis = redis;
    this.#namespace = namespace;
  }

  async apply(update: ActivityLeaderboardUpdate, buckets: ActivityBucket[]): Promise<boolean> {
    const dimension = dimensionKey(update.event.source, update.event.type);
    const keys = [
      `${this.#namespace}:event-states`,
      ...buckets.flatMap((bucket) => [
        this.#countKey(bucket.id, dimension),
        this.#dimensionsKey(bucket.id),
      ]),
    ];
    const script = update.operation === "include" ? APPLY_EVENT : EXCLUDE_EVENT;
    const result = await this.#redis.eval(script, {
      keys,
      arguments: [
        update.event.id,
        update.event.actor,
        dimension,
        ...buckets.map(({ expiresAt }) => String(expiresAt ?? 0)),
      ],
    });
    return Number(result) === 1;
  }

  async listDimensions(bucket: string): Promise<Array<{ source: string; type: string }>> {
    const dimensions = await this.#redis.sMembers(this.#dimensionsKey(bucket));
    return dimensions.map(parseDimensionKey);
  }

  async rank(
    bucket: string,
    dimensions: ActivityDimension[],
    limit: number,
  ): Promise<ActivityLeaderboardEntry[]> {
    if (dimensions.length === 0) return [];
    const temporaryKey = `${this.#namespace}:weighted:${randomUUID()}`;
    const countKeys = dimensions.map((dimension) =>
      this.#countKey(bucket, dimensionKey(dimension.source, dimension.type)),
    );
    try {
      await this.#redis.sendCommand([
        "ZUNIONSTORE",
        temporaryKey,
        String(countKeys.length),
        ...countKeys,
        "WEIGHTS",
        ...dimensions.map(({ pointValue }) => String(pointValue)),
        "AGGREGATE",
        "SUM",
      ]);
      await this.#redis.expire(temporaryKey, 30);
      const weightedActors = await this.#redis.zRangeWithScores(temporaryKey, 0, -1);
      const topActors = weightedActors
        .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
        .slice(0, limit)
        .map(({ value }) => value);
      const pipeline = this.#redis.multi();
      for (const actor of topActors) {
        for (const countKey of countKeys) pipeline.zScore(countKey, actor);
      }
      const scores = (await pipeline.exec()).map(parseRedisScore);
      const actors = new Map<string, ActivityLeaderboardBreakdown[]>();
      let scoreIndex = 0;
      for (const actor of topActors) {
        const breakdown: ActivityLeaderboardBreakdown[] = [];
        for (const dimension of dimensions) {
          const eventCount = Number(scores[scoreIndex++] ?? 0);
          if (eventCount <= 0) continue;
          breakdown.push({
            ...dimension,
            eventCount,
            score: eventCount * dimension.pointValue,
          });
        }
        actors.set(actor, breakdown);
      }
      return rankEntries(actors, limit);
    } finally {
      await this.#redis.del(temporaryKey);
    }
  }

  async close(): Promise<void> {
    if (this.#redis.isOpen) await this.#redis.quit();
  }

  async reset(): Promise<void> {
    let cursor = "0";
    do {
      const result = await this.#redis.scan(cursor, {
        MATCH: `${this.#namespace}:*`,
        COUNT: 200,
      });
      cursor = result.cursor;
      if (result.keys.length > 0) await this.#redis.del(result.keys);
    } while (cursor !== "0");
  }

  async getStatus(): Promise<ActivityLeaderboardStatus> {
    const stored = await this.#redis.hGetAll(`${this.#namespace}:status`);
    if (!stored.state) return emptyStatus("uninitialized");
    return {
      state: parseStatusState(stored.state),
      rebuiltAt: stored.rebuiltAt || null,
      seen: Number(stored.seen ?? 0),
      applied: Number(stored.applied ?? 0),
      hidden: Number(stored.hidden ?? 0),
    };
  }

  async setStatus(status: ActivityLeaderboardStatus): Promise<void> {
    await this.#redis.hSet(`${this.#namespace}:status`, {
      state: status.state,
      rebuiltAt: status.rebuiltAt ?? "",
      seen: String(status.seen),
      applied: String(status.applied),
      hidden: String(status.hidden),
    });
  }

  #countKey(bucket: string, dimension: string): string {
    return `${this.#namespace}:counts:${bucket}:${Buffer.from(dimension).toString("base64url")}`;
  }

  #dimensionsKey(bucket: string): string {
    return `${this.#namespace}:dimensions:${bucket}`;
  }
}

export class ActivityLeaderboard {
  readonly #projection: ActivityLeaderboardProjection;
  readonly #pointValues: ActivityPointValueProvider;
  readonly #now: () => Date;
  #rebuildPromise: Promise<{ seen: number; applied: number; hidden: number }> | null = null;

  constructor(
    projection: ActivityLeaderboardProjection,
    pointValues: ActivityPointValueProvider,
    now: () => Date = () => new Date(),
  ) {
    this.#projection = projection;
    this.#pointValues = pointValues;
    this.#now = now;
  }

  apply(update: ActivityLeaderboardUpdate): Promise<boolean> {
    return this.#waitForRebuild(update);
  }

  async getLeaderboard(input: {
    period: ActivityLeaderboardPeriod;
    limit: number;
    source?: string;
    type?: string;
  }): Promise<ActivityLeaderboardResult> {
    if (this.#rebuildPromise) await this.#rebuildPromise;
    const projection = await this.#projection.getStatus();
    if (projection.state !== "ready") {
      throw new Error(`Activity leaderboard projection is ${projection.state}`);
    }
    const now = this.#now();
    const window = periodWindow(input.period, now);
    const bucket = bucketId(input.period, window.startsAt);
    const pointValues = new Map(
      (await this.#pointValues.listPointValues()).map((value) => [
        dimensionKey(value.source, value.type),
        value.pointValue,
      ]),
    );
    const dimensions = (await this.#projection.listDimensions(bucket))
      .filter(({ source }) => !input.source || source === input.source)
      .filter(({ type }) => !input.type || type === input.type)
      .map(({ source, type }) => ({
        source,
        type,
        pointValue: pointValues.get(dimensionKey(source, type)) ?? 0,
      }))
      .sort((left, right) =>
        left.source === right.source
          ? left.type.localeCompare(right.type)
          : left.source.localeCompare(right.source),
      );
    return {
      period: input.period,
      startsAt: window.startsAt?.toISOString() ?? null,
      endsAt: window.endsAt?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      projection,
      data: await this.#projection.rank(bucket, dimensions, input.limit),
    };
  }

  rebuild(input: {
    events: Iterable<ActivityLeaderboardEvent> | AsyncIterable<ActivityLeaderboardEvent>;
    hiddenEvents: Iterable<ActivityLeaderboardEvent> | AsyncIterable<ActivityLeaderboardEvent>;
  }): Promise<{ seen: number; applied: number; hidden: number }> {
    if (this.#rebuildPromise) return this.#rebuildPromise;
    const rebuild = this.#runRebuild(input);
    this.#rebuildPromise = rebuild;
    const clearRebuild = () => {
      if (this.#rebuildPromise === rebuild) this.#rebuildPromise = null;
    };
    void rebuild.then(clearRebuild, clearRebuild);
    return rebuild;
  }

  getStatus(): Promise<ActivityLeaderboardStatus> {
    return this.#projection.getStatus();
  }

  close(): Promise<void> {
    return this.#projection.close();
  }

  async #waitForRebuild(update: ActivityLeaderboardUpdate): Promise<boolean> {
    if (this.#rebuildPromise) await this.#rebuildPromise;
    return this.#projection.apply(update, eventBuckets(new Date(update.event.timestamp)));
  }

  async #runRebuild(input: {
    events: Iterable<ActivityLeaderboardEvent> | AsyncIterable<ActivityLeaderboardEvent>;
    hiddenEvents: Iterable<ActivityLeaderboardEvent> | AsyncIterable<ActivityLeaderboardEvent>;
  }): Promise<{ seen: number; applied: number; hidden: number }> {
    const rebuilding = emptyStatus("rebuilding");
    await this.#projection.reset();
    await this.#projection.setStatus(rebuilding);
    let hidden = 0;
    let seen = 0;
    let applied = 0;
    try {
      for await (const event of input.hiddenEvents) {
        await this.#projection.apply(
          { operation: "exclude", event },
          eventBuckets(new Date(event.timestamp)),
        );
        hidden += 1;
      }
      for await (const event of input.events) {
        seen += 1;
        applied += Number(
          await this.#projection.apply(
            { operation: "include", event },
            eventBuckets(new Date(event.timestamp)),
          ),
        );
      }
      const status: ActivityLeaderboardStatus = {
        state: "ready",
        rebuiltAt: this.#now().toISOString(),
        seen,
        applied,
        hidden,
      };
      await this.#projection.setStatus(status);
      return { seen, applied, hidden };
    } catch (error) {
      await this.#projection.setStatus({
        state: "failed",
        rebuiltAt: null,
        seen,
        applied,
        hidden,
      });
      throw error;
    }
  }
}

export function createInMemoryActivityLeaderboard(
  pointValues: ActivityPointValueProvider & { now?: () => Date },
): ActivityLeaderboard {
  return new ActivityLeaderboard(
    new InMemoryActivityLeaderboardProjection(),
    pointValues,
    pointValues.now,
  );
}

export async function createRedisActivityLeaderboard(
  input: ActivityPointValueProvider & {
    redisUrl: string;
    namespace?: string;
    now?: () => Date;
  },
): Promise<ActivityLeaderboard> {
  const redis = createClient({ url: input.redisUrl });
  await redis.connect();
  return new ActivityLeaderboard(
    new RedisActivityLeaderboardProjection(redis, input.namespace ?? "activity:leaderboard:v1"),
    input,
    input.now,
  );
}

export class ActivityLeaderboardTag extends Context.Tag("api/ActivityLeaderboard")<
  ActivityLeaderboard,
  ActivityLeaderboard
>() {}

export function ActivityLeaderboardLive(
  input: ActivityPointValueProvider & {
    redisUrl: string;
    namespace?: string;
    now?: () => Date;
  },
) {
  return Layer.scoped(
    ActivityLeaderboardTag,
    Effect.acquireRelease(
      Effect.promise(() => Promise.resolve(createActivityLeaderboard(input))),
      (leaderboard) => Effect.promise(() => leaderboard.close()),
    ),
  );
}

export function createActivityLeaderboard(
  input: ActivityPointValueProvider & {
    redisUrl: string;
    namespace?: string;
    now?: () => Date;
  },
): ActivityLeaderboard | Promise<ActivityLeaderboard> {
  return input.redisUrl === "memory:"
    ? createInMemoryActivityLeaderboard(input)
    : createRedisActivityLeaderboard(input);
}

function eventBuckets(occurredAt: Date): ActivityBucket[] {
  const weekly = periodWindow("weekly", occurredAt);
  const monthly = periodWindow("monthly", occurredAt);
  return [
    { id: "all-time", expiresAt: null },
    {
      id: bucketId("weekly", weekly.startsAt),
      expiresAt: Math.floor((weekly.endsAt!.getTime() + 24 * 60 * 60 * 1_000) / 1_000),
    },
    {
      id: bucketId("monthly", monthly.startsAt),
      expiresAt: Math.floor((monthly.endsAt!.getTime() + 24 * 60 * 60 * 1_000) / 1_000),
    },
  ];
}

function rankEntries(
  actors: Map<string, ActivityLeaderboardBreakdown[]>,
  limit: number,
): ActivityLeaderboardEntry[] {
  return [...actors.entries()]
    .map(([actor, breakdown]) => ({
      rank: 0,
      actor,
      score: breakdown.reduce((total, item) => total + item.score, 0),
      eventCount: breakdown.reduce((total, item) => total + item.eventCount, 0),
      breakdown,
    }))
    .sort((left, right) => right.score - left.score || left.actor.localeCompare(right.actor))
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function dimensionKey(source: string, type: string): string {
  return JSON.stringify([source, type]);
}

function parseDimensionKey(value: string): { source: string; type: string } {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new Error("Activity leaderboard dimension is invalid");
  }
  return { source: parsed[0], type: parsed[1] };
}

function bucketId(period: ActivityLeaderboardPeriod, startsAt: Date | null): string {
  if (period === "all-time") return "all-time";
  return `${period}:${startsAt!.toISOString().slice(0, 10)}`;
}

function periodWindow(
  period: ActivityLeaderboardPeriod,
  now: Date,
): { startsAt: Date | null; endsAt: Date | null } {
  if (period === "all-time") return { startsAt: null, endsAt: null };
  if (period === "monthly") {
    return {
      startsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startsAt.setUTCDate(startsAt.getUTCDate() - ((startsAt.getUTCDay() + 6) % 7));
  return { startsAt, endsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1_000) };
}

function emptyStatus(state: ActivityLeaderboardStatus["state"]): ActivityLeaderboardStatus {
  return { state, rebuiltAt: null, seen: 0, applied: 0, hidden: 0 };
}

function parseStatusState(value: string): ActivityLeaderboardStatus["state"] {
  if (value === "rebuilding" || value === "ready" || value === "failed") return value;
  return "uninitialized";
}

function parseRedisScore(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  throw new Error("Activity leaderboard count is invalid");
}
