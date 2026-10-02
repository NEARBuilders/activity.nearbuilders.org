import { useEffect, useState } from "react";
import { useApiClient } from "@/app";
import type { ActivityFeedEventView } from "@/components/activity-feed";
import { mergeLiveActivityEvent } from "@/hooks/use-activity-feed";

export function useLiveActivityEvents() {
  const apiClient = useApiClient();
  const [events, setEvents] = useState<ActivityFeedEventView[]>([]);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const consume = async () => {
      try {
        const stream = await apiClient.streamActivityEvents({}, { signal: controller.signal });
        if (!active) {
          await stream.return?.();
          return;
        }
        setIsLive(true);
        for await (const event of stream) {
          if (!active) break;
          setEvents((current) => mergeLiveActivityEvent(current, event));
        }
      } catch {}
      if (active) setIsLive(false);
    };
    void consume();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiClient]);

  return { events, isLive };
}
