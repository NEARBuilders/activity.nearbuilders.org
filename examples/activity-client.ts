export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ActivityEvent = {
  id: string;
  source: string;
  type: string;
  actor: string;
  idempotencyKey: string;
  timestamp: string;
  payload: JsonValue;
  provenance: {
    signatureVerified: true;
    publicKey: string;
    signingIdentityStatus: "active" | "retired";
    sourceDisplayName: string;
    integration: "github" | null;
    trustStatus: "standard" | "trusted";
    scoreMultiplier: number;
    payloadClaimsVerified: false;
  };
};

export type ActivityFeed = {
  data: ActivityEvent[];
  meta: { hasMore: boolean; nextCursor: string | null; skippedInvalid: number };
};

export type ActivityLeaderboard = {
  period: "weekly" | "monthly" | "all-time";
  data: Array<{
    rank: number;
    actor: string;
    score: number;
    eventCount: number;
    breakdown: Array<{
      source: string;
      type: string;
      pointValue: number;
      eventCount: number;
      score: number;
    }>;
  }>;
};

export class ActivityApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ActivityApiError";
    this.status = status;
  }
}

export class ActivityClient {
  readonly #apiBaseUrl: string;
  readonly #apiKey?: string;

  constructor(options: { apiBaseUrl: string; apiKey?: string }) {
    this.#apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.#apiKey = options.apiKey;
  }

  submit(input: {
    eventType: string;
    actor: string;
    idempotencyKey: string;
    payload: JsonValue;
  }): Promise<{ eventId: string }> {
    if (!this.#apiKey) throw new Error("Activity Source API Key is required for submission");
    return this.#json("/v1/events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
  }

  listEvents(input: {
    source?: string;
    type?: string;
    actor?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ActivityFeed> {
    return this.#json(`/v1/events${queryString(input)}`);
  }

  leaderboard(input: {
    period: "weekly" | "monthly" | "all-time";
    source?: string;
    type?: string;
    limit?: number;
  }): Promise<ActivityLeaderboard> {
    return this.#json(`/v1/leaderboard${queryString(input)}`);
  }

  async nextEvent(
    input: { source?: string; type?: string; actor?: string },
    options: { timeoutMs?: number; lastEventId?: string } = {},
  ): Promise<ActivityEvent> {
    const response = await fetch(`${this.#apiBaseUrl}/v1/events/stream${queryString(input)}`, {
      headers: {
        accept: "text/event-stream",
        ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (!response.ok || !response.body) throw await activityError(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Activity event stream ended before an event arrived");
        buffered += decoder.decode(value, { stream: true });
        buffered = buffered.replaceAll("\r\n", "\n");
        let boundary = buffered.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) return JSON.parse(data) as ActivityEvent;
          boundary = buffered.indexOf("\n\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.#apiBaseUrl}${path}`, init);
    if (!response.ok) throw await activityError(response);
    return response.json() as Promise<T>;
  }
}

export async function runActivityExample(input: {
  apiBaseUrl: string;
  apiKey: string;
  source: string;
  eventType: string;
  actor: string;
  runId: string;
  subscriptionDelayMs?: number;
}) {
  const client = new ActivityClient({ apiBaseUrl: input.apiBaseUrl, apiKey: input.apiKey });
  const idempotencyKey = `integration-guide:${input.runId}:duplicate`;
  const submission = {
    eventType: input.eventType,
    actor: input.actor,
    idempotencyKey,
    payload: { example: "duplicate", runId: input.runId },
  } as const;
  const first = await client.submit(submission);
  const retried = await client.submit(submission);
  if (first.eventId !== retried.eventId)
    throw new Error("Idempotent retry returned a new event ID");

  const feed = await client.listEvents({
    source: input.source,
    type: input.eventType,
    actor: input.actor,
    limit: 100,
  });
  if (feed.data.filter(({ id }) => id === first.eventId).length !== 1) {
    throw new Error("Idempotent event was not returned exactly once");
  }

  const liveKey = `integration-guide:${input.runId}:live`;
  const streamed = client.nextEvent(
    { source: input.source, type: input.eventType, actor: input.actor },
    { timeoutMs: 10_000, lastEventId: first.eventId },
  );
  await new Promise((resolve) => setTimeout(resolve, input.subscriptionDelayMs ?? 250));
  const live = await client.submit({
    eventType: input.eventType,
    actor: input.actor,
    idempotencyKey: liveKey,
    payload: { example: "live", runId: input.runId },
  });
  const streamedEvent = await streamed;
  if (streamedEvent.id !== live.eventId) throw new Error("SSE returned an unexpected event");

  const leaderboard = await client.leaderboard({
    period: "all-time",
    source: input.source,
    type: input.eventType,
    limit: 100,
  });
  const ranking = leaderboard.data.find(({ actor }) => actor === input.actor);
  if (!ranking || ranking.eventCount !== 2) {
    throw new Error("Duplicate submission changed the expected score contribution count");
  }

  return {
    firstEventId: first.eventId,
    retriedEventId: retried.eventId,
    streamedEventId: streamedEvent.id,
    score: ranking.score,
    eventCount: ranking.eventCount,
  };
}

function queryString(input: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

async function activityError(response: Response): Promise<ActivityApiError> {
  const fallback = `Activity API returned HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { message?: unknown; error?: { message?: unknown } };
    const message =
      typeof body.message === "string"
        ? body.message
        : typeof body.error?.message === "string"
          ? body.error.message
          : fallback;
    return new ActivityApiError(response.status, message);
  } catch {
    return new ActivityApiError(response.status, fallback);
  }
}
