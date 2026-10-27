import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import WebSocket from "ws";
import type { NostrProfile } from "../../lib/schemas";
import { RelayTransport } from "../relay-transport";
import type { NostrEvent, NostrFilter, NostrSubscription } from "../types";
import { nearTargetKey } from "../types";
import type {
  AdapterPublishResult,
  PublishAdapterOptions,
  QueryAdapterOptions,
  RelayAdapter,
  SubscribeAdapterOptions,
} from "./types";

// Prefer the runtime's built-in WebSocket. Production runs on Bun, where the bundled
// `ws` library fails every handshake: Bun's https client reports the 101 upgrade as a
// 'response' event instead of 'upgrade', so ws aborts with "Unexpected server
// response: 101". `ws` remains the fallback for runtimes without a global WebSocket.
useWebSocketImplementation(globalThis.WebSocket ?? WebSocket);

/** Comment kinds: NIP-22 dedicated comment kind + legacy kind 1 */
const COMMENT_KINDS = [1111, 1] as const;
const PUBLISH_KIND = 1111;

export class StandardAdapter implements RelayAdapter {
  readonly type = "standard" as const;
  readonly pool: SimplePool;
  readonly transport: RelayTransport;

  constructor(
    public relays: string[] = ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.primal.net"],
  ) {
    this.pool = new SimplePool({ enablePing: true, enableReconnect: false });
    this.transport = new RelayTransport(this.pool);
  }

  async publish(opts: PublishAdapterOptions): Promise<AdapterPublishResult> {
    const tags = this.#buildTags(opts);
    const event = finalizeEvent(
      {
        kind: PUBLISH_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: opts.content,
      },
      opts.secretKey,
    );

    return this.publishSigned(event, opts.relays);
  }

  async publishSigned(event: NostrEvent, relays?: string[]): Promise<AdapterPublishResult> {
    event = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      sig: event.sig,
    };
    if (!verifyEvent(event)) {
      throw new Error("Invalid Nostr event signature");
    }
    const relayList = relays ?? this.relays;
    const statuses = new Map<string, boolean>();
    await Promise.all(
      relayList.map(async (url) => {
        try {
          const relay = await this.pool.ensureRelay(url, { connectionTimeout: 5_000 });
          await relay.publish(event);
          statuses.set(url, true);
        } catch {
          statuses.set(url, false);
        }
      }),
    );
    return { event, statuses };
  }

  async query(opts: QueryAdapterOptions): Promise<{ events: NostrEvent[] }> {
    const relays = opts.relays ?? this.relays;
    const filter: NostrFilter = {
      kinds: [...COMMENT_KINDS],
      "#t": [opts.targetType, opts.clientName],
      limit: opts.limit ?? 100,
    };
    if (opts.until) filter.until = opts.until;
    if (opts.since) filter.since = opts.since;

    const events = await this.pool.querySync(relays, filter);
    const targetKey = nearTargetKey(opts.targetType, opts.target);
    const filtered = events.filter((e: NostrEvent) =>
      e.tags.some((t: string[]) => t[0] === "near_target" && t[1] === targetKey),
    );
    return { events: filtered };
  }

  subscribe(opts: SubscribeAdapterOptions): NostrSubscription {
    const relays = opts.relays ?? this.relays;
    let closed = false;
    let eventCb: ((event: NostrEvent) => void) | null = null;
    let eoseCb: (() => void) | null = null;
    const targetKey = nearTargetKey(opts.targetType, opts.target);

    const closer = this.pool.subscribeMany(
      relays,
      { kinds: [...COMMENT_KINDS], "#t": [opts.targetType], limit: 100 },
      {
        onevent: (event: NostrEvent) => {
          if (closed || !eventCb) return;
          const hasTarget = event.tags.some(
            (t: string[]) => t[0] === "near_target" && t[1] === targetKey,
          );
          if (hasTarget) eventCb(event);
        },
        oneose: () => {
          if (closed || !eoseCb) return;
          eoseCb();
        },
      },
    );

    return {
      on: (type: string, handler: any) => {
        if (type === "event") eventCb = handler;
        if (type === "eose") eoseCb = handler;
        return {} as NostrSubscription;
      },
      close: () => {
        closed = true;
        closer.close();
      },
    };
  }

  close(): void {
    this.transport.close();
    this.pool.destroy();
  }

  queryRaw(filter: NostrFilter, relays?: string[], signal?: AbortSignal) {
    return this.transport.query(filter, relays ?? this.relays, signal);
  }

  streamRaw(filter: NostrFilter, relays?: string[], signal?: AbortSignal) {
    return this.transport.stream(filter, relays ?? this.relays, signal);
  }

  async getProfile(pubkey: string): Promise<NostrProfile | null> {
    try {
      const events = await this.pool.querySync(this.relays, {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      });
      if (events.length === 0) return null;
      const content = events[0]!.content;
      const parsed = JSON.parse(content);
      return { pubkey, ...parsed };
    } catch {
      return null;
    }
  }

  #buildTags(opts: PublishAdapterOptions): string[][] {
    const tags: string[][] = [];
    tags.push(["t", opts.targetType]);
    tags.push(["t", opts.clientName]);
    tags.push(["p", opts.pubkey]);
    if (opts.nearAccountId) {
      tags.push(["p", `_near:${opts.nearAccountId}`]);
    }
    if (opts.parentEventId) {
      tags.push(["e", opts.rootEventId ?? opts.parentEventId, "", "root"]);
      tags.push(["e", opts.parentEventId, "", "reply"]);
      if (opts.parentPubkey) {
        tags.push(["p", opts.parentPubkey]);
      }
    }
    if (opts.targetUrl) {
      tags.push(["r", opts.targetUrl]);
    }
    tags.push(["client", opts.clientName]);
    tags.push(["near_target", nearTargetKey(opts.targetType, opts.target)]);
    if (opts.nearAccountId) {
      tags.push(["near_account", opts.nearAccountId]);
    }
    if (opts.extraTags) {
      tags.push(...opts.extraTags);
    }
    return tags;
  }
}
