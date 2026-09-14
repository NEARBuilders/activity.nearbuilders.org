import { useMutation, useQuery } from "@tanstack/react-query";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import type {
  ActivityEndorsementView,
  ActivityFeed,
  ActivityFeedEventView,
  ActivityFeedFilters,
} from "@/components/activity-feed";
import { activityFeedOptions } from "@/lib/activity-queries";

type FeedView = ComponentProps<typeof ActivityFeed>;

export function useActivityFeed(
  filters: ActivityFeedFilters,
  onApplyFilters: (filters: ActivityFeedFilters) => void,
): FeedView {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [liveEvents, setLiveEvents] = useState<ActivityFeedEventView[]>([]);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "unavailable">("connecting");
  const [liveEndorsements, setLiveEndorsements] = useState<
    Record<string, Partial<ActivityEndorsementView> & Pick<ActivityEndorsementView, "totalCount">>
  >({});
  const filterKey = JSON.stringify([filters.source, filters.type, filters.actor]);
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey);
    setCursors([undefined]);
    setLiveEvents([]);
    setLiveStatus("connecting");
  }
  const cursor = cursors.at(-1);
  const sessionQuery = useQuery(sessionQueryOptions(authClient, undefined));
  const userId = sessionQuery.data?.user?.id;
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const query = useQuery(activityFeedOptions(apiClient, filters, cursor));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLiveStatus("connecting");
    const consume = async () => {
      try {
        const stream = await apiClient.streamActivityEvents(
          {
            source: filters.source,
            type: filters.type,
            actor: filters.actor,
          },
          { signal: controller.signal },
        );
        if (!active) {
          await stream.return?.();
          return;
        }
        setLiveStatus("live");
        for await (const event of stream) {
          if (!active) break;
          setLiveEvents((current) => mergeLiveActivityEvent(current, event));
        }
        if (active) setLiveStatus("unavailable");
      } catch {
        if (active && !controller.signal.aborted) setLiveStatus("unavailable");
      }
    };
    void consume();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiClient, filters.actor, filters.source, filters.type]);

  const paginatedEvents: ActivityFeedEventView[] = query.data?.data ?? [];
  const events = cursor
    ? paginatedEvents
    : liveEvents.reduceRight(
        (current, event) => mergeLiveActivityEvent(current, event),
        paginatedEvents,
      );
  const eventIds = events.map(({ id }) => id);
  const endorsementQuery = useQuery({
    queryKey: ["activity-event-endorsements", sessionQuery.data?.user?.id ?? "anonymous", eventIds],
    queryFn: () => apiClient.getActivityEventEndorsements({ eventIds }),
    enabled: eventIds.length > 0,
    retry: 1,
  });
  const endorsements = Object.fromEntries(
    eventIds.map((eventId) => {
      const stored = endorsementQuery.data?.[eventId];
      const live = liveEndorsements[eventId];
      return [
        eventId,
        {
          totalCount: live?.totalCount ?? stored?.totalCount ?? 0,
          endorsedByCurrentUser:
            live?.endorsedByCurrentUser ?? stored?.endorsedByCurrentUser ?? false,
        },
      ];
    }),
  );
  const endorsementMutation = useMutation({
    mutationFn: ({
      eventId,
      endorsed,
    }: {
      eventId: string;
      endorsed: boolean;
      userId: string | undefined;
    }) =>
      endorsed
        ? apiClient.unendorseActivityEvent({ eventId })
        : apiClient.endorseActivityEvent({ eventId }),
    onSuccess: (result, variables) => {
      if (variables.userId !== currentUserId.current) return;
      setLiveEndorsements((current) => ({
        ...current,
        [result.eventId]: {
          totalCount: result.totalCount,
          endorsedByCurrentUser: result.endorsedByCurrentUser,
        },
      }));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    setLiveEndorsements({});
  }, [sessionQuery.data?.user?.id]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const consume = async () => {
      try {
        const stream = await apiClient.streamActivityEventEndorsements(
          {},
          { signal: controller.signal },
        );
        if (!active) {
          await stream.return?.();
          return;
        }
        for await (const update of stream) {
          if (!active) break;
          setLiveEndorsements((current) => ({
            ...current,
            [update.eventId]: {
              totalCount: update.totalCount,
              endorsedByCurrentUser: update.changedByCurrentUser
                ? update.operation === "endorsed"
                : current[update.eventId]?.endorsedByCurrentUser,
            },
          }));
        }
      } catch {
        return;
      }
    };
    void consume();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiClient, sessionQuery.data?.user?.id]);

  return {
    onApplyFilters: (nextFilters) => {
      setCursors([undefined]);
      onApplyFilters(nextFilters);
    },
    events,
    filters,
    liveStatus,
    status: query.isError ? "error" : query.isPending ? "loading" : "success",
    errorMessage: query.error instanceof Error ? query.error.message : undefined,
    skippedInvalid: query.data?.meta.skippedInvalid ?? 0,
    hasMore: query.data?.meta.hasMore ?? false,
    canGoBack: cursors.length > 1,
    endorsements,
    canEndorse: Boolean(sessionQuery.data?.user),
    pendingEndorsementId:
      endorsementMutation.isPending && endorsementMutation.variables?.userId === userId
        ? endorsementMutation.variables?.eventId
        : undefined,
    onToggleEndorsement: (eventId) =>
      endorsementMutation.mutate({
        eventId,
        userId,
        endorsed: endorsements[eventId]?.endorsedByCurrentUser ?? false,
      }),
    onNextPage: () => {
      const nextCursor = query.data?.meta.nextCursor;
      if (nextCursor) setCursors((current) => [...current, nextCursor]);
    },
    onPreviousPage: () =>
      setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    onRetry: () => void query.refetch(),
  };
}

function mergeLiveActivityEvent(
  current: readonly ActivityFeedEventView[],
  incoming: ActivityFeedEventView,
): ActivityFeedEventView[] {
  if (current.some(({ id }) => id === incoming.id)) return [...current];
  return [incoming, ...current].slice(0, 20);
}
