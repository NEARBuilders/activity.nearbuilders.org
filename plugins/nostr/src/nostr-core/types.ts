import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";

export type NostrEvent = Event;
export type NostrFilter = Filter;
export type UnsignedNostrEvent = Omit<NostrEvent, "id" | "sig">;

export type RelayMessage =
  | ["EVENT", string, NostrEvent]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["NOTICE", string];

export interface NostrSubscription {
  on<K extends "event" | "eose">(
    type: K,
    handler: K extends "event" ? (event: NostrEvent) => void : () => void,
  ): NostrSubscription;
  close(): void;
}

export const Kind = {
  METADATA: 0,
  TEXT_NOTE: 1,
  RELAY_LIST: 2,
  CONTACT_LIST: 3,
  DELETION: 5,
  REACTION: 7,
  CHANNEL_CREATE: 40,
  CHANNEL_META: 41,
  CHANNEL_MSG: 42,
} as const;

export type ConnectionResult = {
  ok: boolean;
  relay: string;
  message?: string;
};

export function parseRelayEvent(raw: unknown): NostrEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.pubkey !== "string" ||
    typeof r.content !== "string" ||
    typeof r.sig !== "string" ||
    typeof r.created_at !== "number" ||
    typeof r.kind !== "number" ||
    !Array.isArray(r.tags)
  ) {
    return null;
  }
  return raw as NostrEvent;
}

/**
 * Canonical `near_target` tag value for a comment: `${targetType}:${target}`.
 * Single source of truth so adapters + validators + UI all share the same
 * composite-key convention (was previously two callers each picking raw or
 * composite, making UI and plugin comments mutually invisible).
 */
export const nearTargetKey = (targetType: string, target: string): string =>
  `${targetType}:${target}`;

export const findNearTargetTag = (event: NostrEvent): string | undefined =>
  event.tags.find((t) => t[0] === "near_target")?.[1];
