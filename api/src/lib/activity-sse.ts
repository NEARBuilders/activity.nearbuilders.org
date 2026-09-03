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
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": \n\n"));
    },
    async pull(controller) {
      try {
        const next = await events.next();
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
