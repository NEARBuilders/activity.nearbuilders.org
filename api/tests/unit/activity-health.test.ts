import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { ActivityHealthService } from "@/services/activity-health";
import type { ActivityLeaderboardStatus } from "@/services/activity-leaderboard";

const NOW = new Date("2026-09-16T00:00:00.000Z");

function status(state: ActivityLeaderboardStatus["state"]): ActivityLeaderboardStatus {
  return { state, rebuiltAt: null, seen: 0, applied: 0, hidden: 0 };
}

function healthService(overrides: {
  execute?: () => Promise<unknown>;
  checkHealth?: () => Promise<ActivityLeaderboardStatus>;
  ping?: () => Promise<void>;
}) {
  return new ActivityHealthService({
    database: { execute: overrides.execute ?? (async () => ({ rows: [] })) } as unknown as Database,
    leaderboard: { checkHealth: overrides.checkHealth ?? (async () => status("ready")) },
    relay: { ping: overrides.ping ?? (async () => {}) },
    now: () => NOW,
    timeoutMs: 50,
  });
}

describe("Activity health", () => {
  it("reports ok when the database, a Redis write, and the relay all answer", async () => {
    const health = await healthService({}).check();

    expect(health).toMatchObject({
      status: "ok",
      checkedAt: NOW.toISOString(),
      checks: {
        database: { ok: true },
        redis: { ok: true, projection: "ready" },
        relay: { ok: true },
      },
    });
    expect(health.checks.database.error).toBeUndefined();
  });

  it("degrades with a fixed message that does not leak the underlying error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = await healthService({
      checkHealth: async () => {
        throw new Error("connect ECONNREFUSED redis://default:secret@10.0.0.1:6379");
      },
    }).check();
    consoleError.mockRestore();

    expect(health.status).toBe("degraded");
    expect(health.checks.redis).toMatchObject({ ok: false, error: "Redis did not accept a write" });
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(health.checks.database.ok).toBe(true);
    expect(health.checks.relay.ok).toBe(true);
  });

  it("treats a failed leaderboard projection as unhealthy even when Redis answers", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = await healthService({ checkHealth: async () => status("failed") }).check();
    consoleError.mockRestore();

    expect(health.status).toBe("degraded");
    expect(health.checks.redis).toMatchObject({ ok: false, projection: "failed" });
  });

  it("fails a check that never answers instead of hanging", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = await healthService({ ping: () => new Promise<void>(() => {}) }).check();
    consoleError.mockRestore();

    expect(health.status).toBe("degraded");
    expect(health.checks.relay).toMatchObject({ ok: false, error: "Relay did not answer a query" });
  });
});
