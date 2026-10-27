import { Effect, Exit, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrConfigLive, type NostrResolvedConfig } from "../src/lib/nostr-config";
import { BindingService, BindingServiceLive } from "../src/services/binding";

const CFG: NostrResolvedConfig = {
  relays: [],
  clientName: "test",
  kvApiUrl: "https://kv.test",
  bindingContract: "contextual.near",
  standardRelays: [],
  buzzRelays: [],
  buzzSecretKey: undefined,
  challengeExpirySeconds: 300,
};

const TestLayer = Layer.provide(BindingServiceLive, NostrConfigLive(CFG));

const withBinding = <A, E>(
  build: (svc: typeof BindingService.Service) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, never> =>
  Effect.flatMap(BindingService, build).pipe(Effect.provide(TestLayer));

describe("BindingService.getBinding", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJson(status: number, body: unknown): void {
    fetchMock.mockResolvedValueOnce(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
    );
  }

  it("parses a JSON-stringified value at entries[0].value", async () => {
    mockJson(200, {
      entries: [
        {
          value: JSON.stringify({
            npub: "npub1abc",
            relay: "wss://relay.test",
            proof: "proof-json",
            bound_at: 1_700_000_000,
          }),
        },
      ],
    });
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        npub: "npub1abc",
        relay: "wss://relay.test",
        proof: "proof-json",
        bound_at: 1_700_000_000,
      });
    }
  });

  it("parses an object value at entries[0].value", async () => {
    mockJson(200, {
      entries: [
        {
          value: {
            npub: "npub1abc",
            relay: "wss://relay.test",
            proof: "proof-json",
            bound_at: 1_700_000_000,
          },
        },
      ],
    });
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toMatchObject({
        npub: "npub1abc",
        bound_at: 1_700_000_000,
      });
    }
  });

  it("returns null on an empty entries array", async () => {
    mockJson(200, { entries: [] });
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("returns null when entries[0].value is missing", async () => {
    mockJson(200, { entries: [{}] });
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("returns null on a 404 response (no throw)", async () => {
    mockJson(404, "");
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("returns null on a 500 response (no throw)", async () => {
    mockJson(500, "");
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("returns null on malformed JSON in entries[0].value (no throw)", async () => {
    mockJson(200, { entries: [{ value: "not-json{" }] });
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("returns null on fetch network error (no throw)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("hits the FastNear KV URL with the right shape", async () => {
    mockJson(200, { entries: [] });
    await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    const calledUrl = fetchMock.mock.calls[0]?.[0];
    expect(calledUrl).toBe("https://kv.test/v0/latest/contextual.near/alice.near/nostr/alice.near");
  });

  it("survives a non-JSON OK response body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not-json{{", { status: 200 }));
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });

  it("survives an aborted fetch", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const exit = await Effect.runPromiseExit(withBinding((svc) => svc.getBinding("alice.near")));
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });
});

describe("BindingService.getBindingOutput", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps snake_case bound_at to camelCase boundAt", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entries: [
            {
              value: {
                npub: "npub1abc",
                relay: "wss://relay.test",
                proof: "proof-json",
                bound_at: 1_700_000_000,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const exit = await Effect.runPromiseExit(
      withBinding((svc) => svc.getBindingOutput("alice.near")),
    );
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        npub: "npub1abc",
        relay: "wss://relay.test",
        proof: "proof-json",
        boundAt: 1_700_000_000,
      });
    }
  });

  it("returns null when there is no binding", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const exit = await Effect.runPromiseExit(
      withBinding((svc) => svc.getBindingOutput("alice.near")),
    );
    if (Exit.isSuccess(exit)) expect(exit.value).toBeNull();
  });
});
