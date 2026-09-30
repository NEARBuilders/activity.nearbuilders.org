import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/app";

export function latestSourceEventQueryKey(sourceId: string) {
  return ["activity-source-latest-event", sourceId] as const;
}

export function useLatestSourceEvent(
  sourceId: string | null,
  options: { enabled?: boolean; pollUntilFound?: boolean } = {},
) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: latestSourceEventQueryKey(sourceId ?? ""),
    queryFn: async () => {
      const result = await apiClient.listActivityEvents({ source: sourceId ?? "", limit: 1 });
      return result.data[0] ?? null;
    },
    enabled: Boolean(sourceId) && (options.enabled ?? true),
    staleTime: 30_000,
    refetchInterval: (query) =>
      options.pollUntilFound && query.state.data === null ? 5_000 : false,
  });
}
