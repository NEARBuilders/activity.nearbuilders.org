import type { NostrEvent, NostrSubscription } from "../types";

export type RelayAdapterConfig = {
  type: "standard" | "buzz";
  relays: string[];
};

export type AdapterPublishResult = {
  event: NostrEvent;
  statuses: Map<string, boolean>;
};

export type QueryResult = {
  events: NostrEvent[];
};

export interface RelayAdapter {
  readonly type: "standard" | "buzz";

  publish(opts: PublishAdapterOptions): Promise<AdapterPublishResult>;

  publishSigned(event: NostrEvent, relays?: string[]): Promise<AdapterPublishResult>;

  query(opts: QueryAdapterOptions): Promise<QueryResult>;

  subscribe(opts: SubscribeAdapterOptions): NostrSubscription;

  close(): void;
}

export type PublishAdapterOptions = {
  content: string;
  target: string;
  targetType: string;
  clientName: string;
  pubkey: string;
  secretKey: Uint8Array;
  parentEventId?: string;
  rootEventId?: string;
  parentPubkey?: string;
  nearAccountId?: string;
  targetUrl?: string;
  extraTags?: string[][];
  relays?: string[];
};

export type QueryAdapterOptions = {
  target: string;
  targetType: string;
  clientName: string;
  limit?: number;
  until?: number;
  since?: number;
  relays?: string[];
};

export type SubscribeAdapterOptions = {
  target: string;
  targetType: string;
  clientName: string;
  relays?: string[];
};
