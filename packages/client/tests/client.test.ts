import { afterEach, expect, it, vi } from "vitest";
import { createActivityClient } from "../src/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("targets the Activity RPC endpoint and sends a Source API Key", async () => {
  const requests: Array<{ request: Request; options: RequestInit }> = [];
  vi.stubGlobal("fetch", async (request: Request, options: RequestInit) => {
    requests.push({ request, options });
    throw new Error("offline");
  });

  const client = createActivityClient("https://activity.nearbuilders.org///", {
    apiKey: "act_test",
  });

  await expect(client.listActivityEvents({ limit: 5 })).rejects.toThrow();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.request.url).toBe(
    "https://activity.nearbuilders.org/api/rpc/listActivityEvents",
  );
  expect(requests[0]?.request.method).toBe("POST");
  expect(requests[0]?.request.headers.get("authorization")).toBe("Bearer act_test");
  expect(requests[0]?.options.credentials).toBe("include");
});

it("uses session credentials without an authorization header when no key is supplied", async () => {
  const requests: Array<{ request: Request; options: RequestInit }> = [];
  vi.stubGlobal("fetch", async (request: Request, options: RequestInit) => {
    requests.push({ request, options });
    throw new Error("offline");
  });

  const client = createActivityClient("https://activity.nearbuilders.org");

  await expect(client.listActivityEvents({ limit: 5 })).rejects.toThrow();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.request.headers.has("authorization")).toBe(false);
  expect(requests[0]?.options.credentials).toBe("include");
});
