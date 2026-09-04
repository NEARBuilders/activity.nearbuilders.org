import { describe, expect, it, vi } from "vitest";
import type { ActivityFeedEvent } from "@/contract";
import { createActivitySseStream } from "@/lib/activity-sse";

const event: ActivityFeedEvent = {
  id: "a".repeat(64),
  source: "test-source",
  type: "feedback.submitted",
  actor: "alice.near",
  idempotencyKey: "feedback:1",
  timestamp: "2026-09-03T00:00:00.000Z",
  payload: { rating: 5 },
  provenance: {
    signatureVerified: true,
    publicKey: "a".repeat(64),
    signingIdentityStatus: "active",
    sourceDisplayName: "Feedback rounds",
    integration: null,
    trustStatus: "standard",
    scoreMultiplier: 1,
    payloadClaimsVerified: false,
  },
};

describe("createActivitySseStream", () => {
  it("writes stable SSE IDs and retry metadata", async () => {
    async function* events() {
      yield event;
    }

    const body = await new Response(createActivitySseStream(events())).text();

    expect(body).toContain(": \n\n");
    expect(body).toContain("event: message\n");
    expect(body).toContain("retry: 1000\n");
    expect(body).toContain(`id: ${event.id}\n`);
    expect(body).toContain(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("releases the underlying iterator when the client cancels", async () => {
    const release = vi.fn();
    async function* events() {
      try {
        yield event;
        await new Promise(() => undefined);
      } finally {
        release();
      }
    }

    const reader = createActivitySseStream(events()).getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();

    expect(release).toHaveBeenCalledOnce();
  });
});
