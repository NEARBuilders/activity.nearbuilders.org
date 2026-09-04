import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getPluginBaseUrl,
  getPluginClient,
  orgOwnerContext,
  teardown,
} from "../setup";

const execFileAsync = promisify(execFile);

afterAll(teardown);

describe("clean-room Activity client example", () => {
  it("submits, retries, queries, streams, and reads one exact score contribution", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const sourceId = `guide-${suffix}`;
    const organizationId = `guide-org-${suffix}`;
    const owner = await getPluginClient(
      orgOwnerContext(`guide-owner-${suffix}`, organizationId, `${sourceId}.near`),
    );
    await owner.createActivitySource({
      sourceId,
      displayName: "Integration guide fixture",
      nearAccountId: `${sourceId}.near`,
      eventTypes: [
        {
          name: "example.activity",
          description: "Clean-room integration example",
          enabled: true,
          pointValue: 7,
        },
      ],
    });
    const administrator = await getPluginClient(adminContext(`guide-admin-${suffix}`));
    await administrator.reviewActivitySource({
      sourceId,
      decision: "approved",
      reason: "Clean-room integration fixture",
    });
    await owner.createActivitySigningIdentity({ sourceId });
    const prepared = await owner.prepareActivitySigningIdentityBinding({ sourceId });
    const bindingValue = JSON.parse(prepared.value);
    const originalFetch = globalThis.fetch;
    const bindingFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      if (String(request).startsWith("https://kv.main.fastnear.com/")) {
        return new Response(JSON.stringify({ entries: [{ value: bindingValue }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(request, init);
    });
    try {
      await owner.confirmActivitySigningIdentityBinding({ sourceId });
    } finally {
      bindingFetch.mockRestore();
    }
    const credential = await owner.createActivitySourceApiKey({
      sourceId,
      name: "Clean-room smoke test",
    });

    const { stdout, stderr } = await execFileAsync("bun", ["examples/run-activity-example.ts"], {
      cwd: resolve(import.meta.dirname, "../../.."),
      env: {
        ...process.env,
        ACTIVITY_API_BASE_URL: await getPluginBaseUrl(),
        ACTIVITY_API_KEY: credential.secret,
        ACTIVITY_SOURCE_ID: sourceId,
        ACTIVITY_EVENT_TYPE: "example.activity",
        ACTIVITY_ACTOR: "example.near",
        ACTIVITY_EXAMPLE_RUN_ID: suffix,
      },
    });
    const result = JSON.parse(stdout);

    expect(`${stdout}${stderr}`).not.toContain(credential.secret);
    expect(result).toMatchObject({
      firstEventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      retriedEventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      streamedEventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      eventCount: 2,
      score: 14,
    });
    expect(result.retriedEventId).toBe(result.firstEventId);
  });
});
