import { afterEach, describe, expect, it, vi } from "vitest";
import { readOnChainBinding } from "@/services/activity-credentials";

const CONFIG = { kvApiUrl: "https://kv.test/", contractId: "contextual.near" };
const SLOT_URL = "https://kv.test/v0/latest/contextual.near/owner.near/activity/source-a";

function respondWith(response: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
}

function json(body: unknown, status = 200) {
  return () => new Response(JSON.stringify(body), { status });
}

function sentHeaders(fetchSpy: ReturnType<typeof respondWith>) {
  return new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FastKV binding read", () => {
  it("sends the FastNear API key as a bearer token", async () => {
    const fetchSpy = respondWith(json({ entries: [{ value: { npub: "a".repeat(64) } }] }));

    await expect(
      readOnChainBinding(
        { ...CONFIG, kvApiKey: "fastnear-key" },
        "owner.near",
        "activity/source-a",
      ),
    ).resolves.toEqual({ npub: "a".repeat(64) });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(SLOT_URL);
    expect(sentHeaders(fetchSpy).get("authorization")).toBe("Bearer fastnear-key");
  });

  it("reads without an authorization header when no key is configured", async () => {
    for (const kvApiKey of [undefined, "", "  "]) {
      const fetchSpy = respondWith(json({ entries: [] }));

      await expect(
        readOnChainBinding({ ...CONFIG, kvApiKey }, "owner.near", "activity/source-a"),
      ).resolves.toBeNull();

      expect(sentHeaders(fetchSpy).has("authorization")).toBe(false);
      fetchSpy.mockRestore();
    }
  });

  it.each([
    [429, "FastKV quota is exhausted", "quota exhausted"],
    [401, "FastKV rejected the API key", "API key rejected"],
    [403, "FastKV rejected the API key", "API key rejected"],
  ])("fails closed with a distinct error and log line on HTTP %i", async (status, message, reason) => {
    respondWith(json({ error: "refused" }, status));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      readOnChainBinding(
        { ...CONFIG, kvApiKey: "fastnear-key" },
        "owner.near",
        "activity/source-a",
      ),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining(message),
    });

    expect(logged).toHaveBeenCalledWith(
      `[ActivityBinding] FastKV refused the binding read for owner.near/activity/source-a: HTTP ${status} (${reason})`,
    );
    expect(logged.mock.calls.flat().join(" ")).not.toContain("fastnear-key");
  });

  it("names a missing key when FastKV requires one and none is configured", async () => {
    respondWith(json({ error: "unauthorized" }, 401));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      readOnChainBinding(CONFIG, "owner.near", "activity/source-a"),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Binding confirmation is unavailable: FastKV requires an API key",
    });

    expect(logged).toHaveBeenCalledWith(
      "[ActivityBinding] FastKV refused the binding read for owner.near/activity/source-a: HTTP 401 (API key required, none configured)",
    );
  });

  it("still treats other failures as a binding that is not available yet, logging outages", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const response of [json({}, 404), () => new Response("not json")]) {
      respondWith(response);
      await expect(
        readOnChainBinding(CONFIG, "owner.near", "activity/source-a"),
      ).resolves.toBeNull();
    }
    expect(logged).not.toHaveBeenCalled();

    respondWith(json({}, 502));
    await expect(readOnChainBinding(CONFIG, "owner.near", "activity/source-a")).resolves.toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(readOnChainBinding(CONFIG, "owner.near", "activity/source-a")).resolves.toBeNull();

    expect(logged.mock.calls.map(([message]) => message)).toEqual([
      "[ActivityBinding] FastKV binding read failed for owner.near/activity/source-a: HTTP 502",
      "[ActivityBinding] FastKV binding read failed for owner.near/activity/source-a: TypeError",
    ]);
  });
});
