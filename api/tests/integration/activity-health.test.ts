import { afterAll, describe, expect, it } from "vitest";
import { getPluginBaseUrl, getPluginClient, teardown } from "../setup";

afterAll(teardown);

describe("Activity health endpoint", () => {
  it("checks the database, a Redis write, and the relay over public HTTP", async () => {
    const response = await fetch(`${await getPluginBaseUrl()}/v1/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: {
        database: { ok: true },
        redis: { ok: true, projection: "ready" },
        relay: { ok: true },
      },
    });
  });

  it("is available through the typed client without authentication", async () => {
    const client = await getPluginClient();

    await expect(client.getActivityHealth()).resolves.toMatchObject({ status: "ok" });
  });
});
