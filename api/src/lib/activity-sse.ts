import type { ActivityFeedEvent } from "../contract";

const encoder = new TextEncoder();

function encodeActivityEvent(event: ActivityFeedEvent): Uint8Array {
  return encoder.encode(
    `event: message\nretry: 1000\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

/**
 * Encodes the public Activity feed directly so SSE metadata survives the
 * host's Module Federation boundary. Native streams are passed through by
 * oRPC without re-serializing their frames.
 */
export function createActivitySseStream(
  events: AsyncGenerator<ActivityFeedEvent>,
  ready: Promise<void> = Promise.resolve(),
): ReadableStream<Uint8Array> {
  let pendingEvent: Promise<IteratorResult<ActivityFeedEvent>> | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      pendingEvent = events.next();
      try {
        const outcome = await Promise.race([
          ready.then(() => ({ type: "ready" as const })),
          pendingEvent.then((event) => ({ type: "event" as const, event })),
        ]);
        if (outcome.type === "event") pendingEvent = Promise.resolve(outcome.event);
        controller.enqueue(encoder.encode(": ready\n\n"));
      } catch (error) {
        controller.error(error);
      }
    },
    async pull(controller) {
      try {
        const next = await (pendingEvent ?? events.next());
        pendingEvent = undefined;
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encodeActivityEvent(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}
