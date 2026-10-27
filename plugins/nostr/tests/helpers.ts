import type { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Layer } from "effect";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { expect, vi } from "vitest";
import { NostrConfigLive, type NostrResolvedConfig } from "../src/lib/nostr-config";
import type { NostrEvent } from "../src/nostr-core/types";
import { BindingService, BindingServiceLive } from "../src/services/binding";

export const CFG: NostrResolvedConfig = {
  relays: [],
  clientName: "test",
  kvApiUrl: "https://kv.test",
  bindingContract: "contextual.near",
  standardRelays: ["wss://relay.test"],
  buzzRelays: [],
  buzzSecretKey: undefined,
  challengeExpirySeconds: 300,
};

export const TestLayer = Layer.provide(BindingServiceLive, NostrConfigLive(CFG));

export const withBinding = <A, E>(
  build: (svc: typeof BindingService.Service) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, never> =>
  Effect.flatMap(BindingService, build).pipe(Effect.provide(TestLayer));

export function makeBindingEvent(content: string): NostrEvent {
  const sk = generateSecretKey();
  return finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", "alice.near"]],
      content,
    },
    sk,
  );
}

export async function expectBadRequest<A>(
  build: (
    svc: typeof BindingService.Service,
  ) => Effect.Effect<A, ORPCError<"BAD_REQUEST", unknown>, never>,
): Promise<void> {
  const exit = await Effect.runPromiseExit(withBinding(build));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;
  const squashed = Cause.squash(exit.cause);
  expect(squashed).toMatchObject({ code: "BAD_REQUEST" });
}

export function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function mockJsonResponse(
  fetchMock: ReturnType<typeof vi.fn>,
  status: number,
  body: unknown,
): void {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    }),
  );
}
