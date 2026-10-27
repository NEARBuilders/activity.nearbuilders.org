import { ORPCError } from "@orpc/server";
import type { SimplePool } from "nostr-tools/pool";
import type { NostrEvent, NostrFilter } from "./types";

const TIMEOUT_MS = 5_000;
const MAX_EVENTS = 1_000;
const MAX_SEEN = 10_000;
const REPLAY_OVERLAP_SECONDS = 30;

export class RelayTransport {
  readonly #operations = new Set<AbortController>();
  #closed = false;

  constructor(private readonly pool: SimplePool) {}

  #operation(signal?: AbortSignal): AbortController {
    if (this.#closed) {
      throw new ORPCError("RELAY_UNAVAILABLE", {
        message: "Relay transport is closed",
      });
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener(
      "abort",
      () => {
        signal?.removeEventListener("abort", abort);
        this.#operations.delete(controller);
      },
      { once: true },
    );
    this.#operations.add(controller);
    if (signal?.aborted) abort();
    return controller;
  }

  async query(filter: NostrFilter, relays: string[], signal?: AbortSignal) {
    const controller = this.#operation(signal);
    const limit = filter.limit ?? MAX_EVENTS;
    try {
      const results = await Promise.all(
        relays.map((url) => this.#queryRelay(url, { ...filter, limit }, controller.signal)),
      );
      const events = [...new Map(results.flat().map((event) => [event.id, event])).values()].sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      );
      return {
        events: events.slice(0, limit),
        meta: {
          limited:
            limit > 0 &&
            (events.length > limit || results.some((result) => result.length >= limit)),
        },
      };
    } finally {
      controller.abort();
    }
  }

  #queryRelay(url: string, filter: NostrFilter, signal: AbortSignal): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const events: NostrEvent[] = [];
      let settled = false;
      let subscription: { close(): void } | undefined;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        subscription?.close();
        if (error) reject(error);
        else resolve(events);
      };
      const abort = () =>
        finish(new ORPCError("RELAY_UNAVAILABLE", { message: "Relay query cancelled" }));
      const timer = setTimeout(
        () =>
          finish(
            new ORPCError("RELAY_TIMEOUT", {
              message: "Relay did not finish its response",
            }),
          ),
        TIMEOUT_MS,
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void this.pool
        .ensureRelay(url, { connectionTimeout: TIMEOUT_MS })
        .then((relay) => {
          if (settled) return;
          subscription = relay.subscribe([filter], {
            onevent: (event) => {
              if (events.length < (filter.limit ?? MAX_EVENTS)) events.push(event);
            },
            oneose: () => finish(),
            onclose: () =>
              finish(
                new ORPCError("RELAY_UNAVAILABLE", {
                  message: "Relay closed before completing its response",
                }),
              ),
            eoseTimeout: TIMEOUT_MS + 1_000,
          });
        })
        .catch(() =>
          finish(
            new ORPCError("RELAY_UNAVAILABLE", {
              message: "Could not connect to relay",
            }),
          ),
        );
    });
  }

  async *stream(
    filter: NostrFilter,
    relays: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<NostrEvent> {
    const controller = this.#operation(signal);
    const queue: NostrEvent[] = [];
    const seen = new Set<string>();
    let wake: (() => void) | undefined;
    let failure: unknown;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const fail = (error: unknown) => {
      failure = error;
      controller.abort();
    };
    const accept = (event: NostrEvent) => {
      if (seen.has(event.id)) return;
      if (queue.length >= MAX_EVENTS) {
        fail(
          new ORPCError("RELAY_LIMIT", {
            message: "Live event consumer is too slow; resume from a persisted boundary",
          }),
        );
        return;
      }
      seen.add(event.id);
      if (seen.size > MAX_SEEN) {
        fail(
          new ORPCError("RELAY_LIMIT", {
            message: "Subscription deduplication limit reached; resume from a persisted boundary",
          }),
        );
        return;
      }
      queue.push(event);
      notify();
    };
    controller.signal.addEventListener("abort", notify, { once: true });
    const closers = relays.map((url) =>
      this.#subscribeRelay(url, filter, controller.signal, accept, fail),
    );
    try {
      while (!controller.signal.aborted) {
        const event = queue.shift();
        if (event) yield event;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      if (failure) throw failure;
    } finally {
      controller.abort();
      for (const close of closers) close();
      queue.length = 0;
    }
  }

  #subscribeRelay(
    url: string,
    filter: NostrFilter,
    signal: AbortSignal,
    accept: (event: NostrEvent) => void,
    fail: (error: unknown) => void,
  ): () => void {
    let closed = signal.aborted;
    let subscription: { close(): void } | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let initial = true;
    let replaySince = filter.since ?? Math.floor(Date.now() / 1_000);
    const close = () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(deadline);
      signal.removeEventListener("abort", close);
      subscription?.close();
    };
    const schedule = () => {
      clearTimeout(deadline);
      if (closed || reconnectTimer) return;
      const delay = Math.min(250 * 2 ** Math.min(attempt++, 5), 5_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (closed) return;
      try {
        const relay = await this.pool.ensureRelay(url, { connectionTimeout: TIMEOUT_MS });
        if (closed) return;
        const connectedAt = Math.floor(Date.now() / 1_000);
        let stored = 0;
        let live = false;
        const limit = initial ? (filter.limit ?? MAX_EVENTS) : MAX_EVENTS;
        const requested = { ...filter, since: replaySince, limit };
        deadline = setTimeout(() => {
          fail(
            new ORPCError("RELAY_TIMEOUT", {
              message: "Relay did not complete subscription replay",
            }),
          );
        }, TIMEOUT_MS);
        subscription = relay.subscribe([requested], {
          onevent: (event) => {
            if (closed) return;
            if (!live) stored++;
            if (!live && stored >= limit && limit > 0) {
              fail(
                new ORPCError("RELAY_LIMIT", {
                  message: "Subscription history reached its limit; narrow the replay range",
                }),
              );
              return;
            }
            accept(event);
            if (live)
              replaySince = Math.max(
                replaySince,
                Math.floor(Date.now() / 1_000) - REPLAY_OVERLAP_SECONDS,
              );
          },
          oneose: () => {
            clearTimeout(deadline);
            live = true;
            initial = false;
            attempt = 0;
            replaySince = Math.max(replaySince, connectedAt - REPLAY_OVERLAP_SECONDS);
          },
          onclose: (reason) => {
            if (/^(auth-required|restricted|invalid|blocked):/.test(reason)) {
              fail(
                new ORPCError("RELAY_UNAVAILABLE", {
                  message: "Relay rejected the subscription",
                  data: { relay: url, reason },
                }),
              );
            } else schedule();
          },
          eoseTimeout: TIMEOUT_MS + 1_000,
        });
      } catch {
        if (initial)
          fail(
            new ORPCError("RELAY_UNAVAILABLE", {
              message: "Could not connect to relay",
            }),
          );
        else schedule();
      }
    };
    signal.addEventListener("abort", close, { once: true });
    void connect();
    return close;
  }

  close(): void {
    this.#closed = true;
    for (const operation of this.#operations) operation.abort();
  }
}
