import { sql } from "drizzle-orm";
import type { ActivityRelay } from "../activity/activity-relay";
import type { ActivityHealth, ActivityHealthCheck } from "../contract";
import type { Database } from "../db";
import type { ActivityLeaderboard, ActivityLeaderboardStatus } from "./activity-leaderboard";

const CHECK_TIMEOUT_MS = 8_000;

type ActivityHealthDependencies = {
  database: Database;
  leaderboard: Pick<ActivityLeaderboard, "checkHealth">;
  relay: Pick<ActivityRelay, "ping">;
  now?: () => Date;
  timeoutMs?: number;
};

/**
 * Checks every dependency Activity needs to accept and serve events: the database, the Redis
 * projection store (a real write, not only a read), and the relay through its configured
 * transport. Failures carry a fixed message so the public response never leaks connection
 * details; the underlying error is logged server-side.
 */
export class ActivityHealthService {
  readonly #deps: ActivityHealthDependencies;

  constructor(deps: ActivityHealthDependencies) {
    this.#deps = deps;
  }

  async check(): Promise<ActivityHealth> {
    const timeoutMs = this.#deps.timeoutMs ?? CHECK_TIMEOUT_MS;
    let projection: ActivityLeaderboardStatus["state"] | undefined;
    const [database, redis, relay] = await Promise.all([
      timedCheck("database", "Database did not answer", timeoutMs, async () => {
        await this.#deps.database.execute(sql`select 1`);
      }),
      timedCheck("redis", "Redis did not accept a write", timeoutMs, async () => {
        projection = (await this.#deps.leaderboard.checkHealth()).state;
        if (projection === "failed" || projection === "uninitialized") {
          throw new Error(`Leaderboard projection is ${projection}`);
        }
      }),
      timedCheck("relay", "Relay did not answer a query", timeoutMs, () => this.#deps.relay.ping()),
    ]);
    const checks = { database, redis: { ...redis, projection }, relay };
    return {
      status: database.ok && redis.ok && relay.ok ? "ok" : "degraded",
      checkedAt: (this.#deps.now?.() ?? new Date()).toISOString(),
      checks,
    };
  }
}

async function timedCheck(
  name: string,
  failureMessage: string,
  timeoutMs: number,
  run: () => Promise<void>,
): Promise<ActivityHealthCheck> {
  const startedAt = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Health check timed out")), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: elapsed(startedAt) };
  } catch (error) {
    console.error(`[ActivityHealth] ${name} check failed:`, error);
    return { ok: false, latencyMs: elapsed(startedAt), error: failureMessage };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
