import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { Filter } from "nostr-tools";
import type { Event } from "nostr-tools/pure";
import {
  type ActivityRelayAdapter,
  ActivityRelayQueryTimeoutError,
  ActivityRelayScanLimitError,
  ActivityRelayUnavailableError,
} from "./activity-relay";

export type SharedNostrFilter = Pick<
  Filter,
  "kinds" | "authors" | "ids" | "since" | "until" | "limit"
> & {
  tags: Array<{ tag: string; values: string[] }>;
};

export type SharedNostrClient = {
  publishEvent(input: { event: Event; relays: string[] }): Promise<{
    eventId: string;
    statuses: Array<{ relay: string; success: boolean }>;
  }>;
  queryEvents(
    input: { filter: SharedNostrFilter; relays: string[] },
    options?: { signal?: AbortSignal },
  ): Promise<{
    events: Event[];
    meta: { limited: boolean };
  }>;
  subscribeEvents(
    input: { filter: SharedNostrFilter; relays: string[] },
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<Event>>;
};

function convertFilter(filter: Filter): SharedNostrFilter {
  const { kinds, authors, ids, since, until, limit } = filter;
  const tags = Object.entries(filter).flatMap(([key, value]) =>
    /^#[a-zA-Z]$/.test(key) && Array.isArray(value)
      ? [
          {
            tag: key.slice(1),
            values: value.filter((item): item is string => typeof item === "string"),
          },
        ]
      : [],
  );
  return { kinds, authors, ids, since, until, limit, tags };
}

function relayFailure(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "RELAY_LIMIT") return new ActivityRelayScanLimitError();
  if (code === "RELAY_TIMEOUT" || (error instanceof Error && error.name === "TimeoutError")) {
    return new ActivityRelayQueryTimeoutError();
  }
  return new ActivityRelayUnavailableError();
}

export class SharedNostrRelayAdapter implements ActivityRelayAdapter {
  readonly #controllers = new Set<AbortController>();
  #closed = false;

  constructor(
    private readonly client: SharedNostrClient,
    private readonly relayUrl: string,
  ) {}

  static connect(rpcUrl: string, relayUrl: string): SharedNostrRelayAdapter {
    const url = new URL(rpcUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Activity Nostr RPC URL must be HTTP(S) without credentials");
    }
    const client = createORPCClient<SharedNostrClient>(new RPCLink({ url: url.href }));
    return new SharedNostrRelayAdapter(client, relayUrl);
  }

  async publish(event: Event): Promise<string> {
    if (this.#closed) throw new ActivityRelayUnavailableError();
    try {
      const result = await this.client.publishEvent({ event, relays: [this.relayUrl] });
      if (
        result.eventId !== event.id ||
        !result.statuses.some((status) => status.relay === this.relayUrl && status.success)
      ) {
        throw new ActivityRelayUnavailableError();
      }
      return "";
    } catch (error) {
      throw relayFailure(error);
    }
  }

  async query(filter: Filter): Promise<Event[]> {
    if (this.#closed) throw new ActivityRelayUnavailableError();
    try {
      const result = await this.client.queryEvents(
        {
          filter: convertFilter({ ...filter, limit: Math.min(filter.limit ?? 500, 500) }),
          relays: [this.relayUrl],
        },
        { signal: AbortSignal.timeout(5_500) },
      );
      if (result.meta.limited) throw new ActivityRelayScanLimitError();
      return result.events;
    } catch (error) {
      if (error instanceof ActivityRelayScanLimitError) throw error;
      throw relayFailure(error);
    }
  }

  async subscribe(
    filter: Filter,
    onEvent: (event: Event) => void,
    onError?: (error: Error) => void,
  ) {
    if (this.#closed) throw new ActivityRelayUnavailableError();
    const controller = new AbortController();
    this.#controllers.add(controller);
    const close = () => {
      controller.abort();
      this.#controllers.delete(controller);
    };
    try {
      const stream = await this.client.subscribeEvents(
        { filter: convertFilter(filter), relays: [this.relayUrl] },
        { signal: controller.signal },
      );
      void (async () => {
        try {
          for await (const event of stream) {
            if (controller.signal.aborted) break;
            onEvent(event);
          }
          if (!controller.signal.aborted) onError?.(new ActivityRelayUnavailableError());
        } catch (error) {
          if (!controller.signal.aborted) onError?.(relayFailure(error));
        } finally {
          close();
        }
      })();
      return { close };
    } catch (error) {
      close();
      throw relayFailure(error);
    }
  }

  close(): void {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }
}
