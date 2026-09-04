import { type Event, finalizeEvent } from "nostr-tools/pure";
import { ActivityProjection } from "@/activity/activity-projection";
import {
  ACTIVITY_EVENT_KIND,
  type ActivityQuery,
  type ActivityQueryResult,
  ActivityRelay,
  NostrRelayAdapter,
} from "@/activity/activity-relay";

export { ACTIVITY_EVENT_KIND } from "@/activity/activity-relay";

export type ActivityEventInput = {
  source: string;
  eventType: string;
  actor: string;
  idempotencyKey: string;
  payload: unknown;
  createdAt?: number;
};

export function signActivityEvent(input: ActivityEventInput, secretKeyHex: string): Event {
  const secretKey = Uint8Array.from(Buffer.from(secretKeyHex, "hex"));
  if (secretKey.length !== 32) {
    throw new Error("Nostr secret key must be 32 bytes");
  }

  return finalizeEvent(
    {
      kind: ACTIVITY_EVENT_KIND,
      created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
      tags: [
        ["s", input.source],
        ["t", input.eventType],
        ["n", input.actor],
        ["i", input.idempotencyKey],
      ],
      content: JSON.stringify(input.payload),
    },
    secretKey,
  );
}

export class ActivityBoundary {
  readonly #relay: ActivityRelay;
  readonly #projection: ActivityProjection;

  private constructor(relay: ActivityRelay, projection: ActivityProjection) {
    this.#relay = relay;
    this.#projection = projection;
  }

  static async connect(input: { relayUrl: string; redisUrl: string }): Promise<ActivityBoundary> {
    return new ActivityBoundary(
      new ActivityRelay(new NostrRelayAdapter(input.relayUrl), { scanLimit: 1_000 }),
      await ActivityProjection.connect(input.redisUrl),
    );
  }

  async publish(event: Event): Promise<{ accepted: true; message: string }> {
    return this.#relay.publish(event);
  }

  async query(input: ActivityQuery): Promise<ActivityQueryResult> {
    return this.#relay.query(input);
  }

  async subscribe(
    input: ActivityQuery,
    onEvent: (event: Event) => void,
  ): Promise<{ close: () => void }> {
    return this.#relay.subscribe(input, onEvent);
  }

  async replay(input: ActivityQuery): Promise<{ seen: number; applied: number }> {
    return this.#projection.replay(this.#relay, input);
  }

  async getProjectionCount(input: {
    source: string;
    actor: string;
    eventType: string;
  }): Promise<number> {
    return this.#projection.getCount(input);
  }

  async close(): Promise<void> {
    this.#relay.close();
    await this.#projection.close();
  }
}
