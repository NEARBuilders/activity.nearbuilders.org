// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedEventView } from "@/components/activity-feed";
import { useActivityFeed } from "@/hooks/use-activity-feed";

const mocks = vi.hoisted(() => ({
  client: {
    listActivityEvents: vi.fn(),
    streamActivityEvents: vi.fn(),
    getActivityEventEndorsements: vi.fn(),
    streamActivityEventEndorsements: vi.fn(),
    endorseActivityEvent: vi.fn(),
    unendorseActivityEvent: vi.fn(),
  },
}));

vi.mock("@/app", () => ({
  useApiClient: () => mocks.client,
  useAuthClient: () => null,
  sessionQueryOptions: () => ({
    queryKey: ["session"],
    queryFn: async () => ({ user: { id: "alice" } }),
    staleTime: Infinity,
  }),
}));

function controlledStream<T>() {
  const values: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(value: T) {
      values.push(value);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *iterate(signal?: AbortSignal) {
      const abort = () => {
        closed = true;
        wake?.();
      };
      signal?.addEventListener("abort", abort);
      try {
        while (!closed) {
          const value = values.shift();
          if (value !== undefined) yield value;
          else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
        }
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

function event(id: string): ActivityFeedEventView {
  return {
    id,
    source: "feedback",
    type: "submitted",
    actor: "alice.near",
    idempotencyKey: id,
    timestamp: "2026-09-03T00:00:00.000Z",
    payload: {},
    provenance: {
      signatureVerified: true,
      publicKey: "key",
      signingIdentityStatus: "active",
      sourceDisplayName: "Feedback",
      integration: null,
      trustStatus: "standard",
      scoreMultiplier: 1,
      payloadClaimsVerified: false,
    },
  };
}

function setup() {
  const live = controlledStream<ActivityFeedEventView>();
  const endorsementStreams: ReturnType<
    typeof controlledStream<{
      eventId: string;
      totalCount: number;
      changedByCurrentUser: boolean;
      operation: string;
    }>
  >[] = [];
  const signals: AbortSignal[] = [];
  mocks.client.listActivityEvents.mockImplementation(async ({ cursor }) => ({
    data: [event(cursor ? "older" : "first")],
    meta: { hasMore: !cursor, nextCursor: cursor ? null : "page-2", skippedInvalid: 0 },
  }));
  mocks.client.streamActivityEvents.mockImplementation(async (_input, { signal }) => {
    signals.push(signal);
    return live.iterate(signal);
  });
  mocks.client.getActivityEventEndorsements.mockResolvedValue({
    first: { totalCount: 0, endorsedByCurrentUser: false },
  });
  mocks.client.streamActivityEventEndorsements.mockImplementation(async (_input, { signal }) => {
    signals.push(signal);
    const stream = controlledStream<{
      eventId: string;
      totalCount: number;
      changedByCurrentUser: boolean;
      operation: string;
    }>();
    endorsementStreams.push(stream);
    return stream.iterate(signal);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["session"], { user: { id: "alice" } });
  function wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { live, endorsementStreams, signals, queryClient, wrapper };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useActivityFeed", () => {
  it("merges and deduplicates live events only on the first page, then aborts both streams", async () => {
    const context = setup();
    const { result, unmount } = renderHook(() => useActivityFeed({}, vi.fn()), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.events.map(({ id }) => id)).toEqual(["first"]));
    await act(async () => {
      context.live.push(event("new"));
      context.live.push(event("new"));
    });
    await waitFor(() =>
      expect(result.current.events.map(({ id }) => id)).toEqual(["new", "first"]),
    );
    act(() => result.current.onNextPage());
    await waitFor(() => expect(result.current.events.map(({ id }) => id)).toEqual(["older"]));
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.onPreviousPage?.());
    await waitFor(() =>
      expect(result.current.events.map(({ id }) => id)).toEqual(["new", "first"]),
    );
    unmount();
    expect(context.signals.every((signal) => signal.aborted)).toBe(true);
    context.queryClient.clear();
  });

  it("returns to the first page when the current filters are applied again", async () => {
    const context = setup();
    const navigate = vi.fn();
    const filters = { source: "feedback" };
    const { result } = renderHook(() => useActivityFeed(filters, navigate), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    act(() => result.current.onNextPage());
    await waitFor(() => expect(result.current.events[0]?.id).toBe("older"));
    act(() => result.current.onApplyFilters(filters));
    await waitFor(() => expect(result.current.events[0]?.id).toBe("first"));
    expect(result.current.canGoBack).toBe(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(filters);
    context.queryClient.clear();
  });

  it("bounds the live first page to twenty distinct events", async () => {
    const context = setup();
    const { result } = renderHook(() => useActivityFeed({}, vi.fn()), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    await act(async () => {
      for (let index = 0; index < 25; index += 1) context.live.push(event(`live-${index}`));
      context.live.push(event("live-24"));
    });
    await waitFor(() => expect(result.current.events).toHaveLength(20));
    expect(result.current.events.map(({ id }) => id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `live-${24 - index}`),
    );
    context.queryClient.clear();
  });

  it("resets pagination and buffered live events when filters change", async () => {
    const context = setup();
    const { result, rerender } = renderHook(({ source }) => useActivityFeed({ source }, vi.fn()), {
      initialProps: { source: "first-source" },
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    await act(async () => context.live.push(event("buffered")));
    await waitFor(() => expect(result.current.events[0]?.id).toBe("buffered"));
    act(() => result.current.onNextPage());
    await waitFor(() => expect(result.current.events[0]?.id).toBe("older"));
    rerender({ source: "second-source" });
    await waitFor(() => expect(result.current.events.map(({ id }) => id)).toEqual(["first"]));
    expect(result.current.canGoBack).toBe(false);
    expect(context.signals[0]?.aborted).toBe(true);
    expect(mocks.client.listActivityEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "second-source", cursor: undefined }),
    );
    context.queryClient.clear();
  });

  it("closes a live iterator that opens after unmount", async () => {
    const context = setup();
    let open: ((stream: AsyncGenerator<ActivityFeedEventView>) => void) | undefined;
    mocks.client.streamActivityEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          open = resolve;
        }),
    );
    const { unmount } = renderHook(() => useActivityFeed({}, vi.fn()), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(open).toBeDefined());
    unmount();
    const stream = context.live.iterate();
    const close = vi.spyOn(stream, "return");
    await act(async () => open?.(stream));
    expect(close).toHaveBeenCalledOnce();
    context.queryClient.clear();
  });

  it("reports a normally closed live stream as unavailable while retaining the page", async () => {
    const context = setup();
    const { result } = renderHook(() => useActivityFeed({}, vi.fn()), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.liveStatus).toBe("live"));
    await act(async () => context.live.close());
    await waitFor(() => expect(result.current.liveStatus).toBe("unavailable"));
    expect(result.current.events.map(({ id }) => id)).toEqual(["first"]);
    context.queryClient.clear();
  });

  it("discards a previous user's pending endorsement result and restarts personalized updates", async () => {
    const context = setup();
    let complete:
      | ((value: { eventId: string; totalCount: number; endorsedByCurrentUser: boolean }) => void)
      | undefined;
    mocks.client.endorseActivityEvent.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result } = renderHook(() => useActivityFeed({}, vi.fn()), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    act(() => result.current.onToggleEndorsement?.("first"));
    await waitFor(() => expect(complete).toBeDefined());
    act(() => context.queryClient.setQueryData(["session"], { user: { id: "bob" } }));
    await waitFor(() => expect(context.endorsementStreams).toHaveLength(2));
    expect(context.signals[1]?.aborted).toBe(true);
    await act(async () =>
      complete?.({ eventId: "first", totalCount: 1, endorsedByCurrentUser: true }),
    );
    await waitFor(() => expect(result.current.pendingEndorsementId).toBeUndefined());
    expect(result.current.endorsements?.first?.endorsedByCurrentUser).toBe(false);
    context.queryClient.clear();
  });
});
