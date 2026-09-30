import { useIsClient } from "@/hooks/use-client";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

const RELATIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const fullDate = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function ActivityTimestamp({ value, className }: { value: string; className?: string }) {
  const isClient = useIsClient();
  const date = new Date(value);
  const isRecent = isClient && Date.now() - date.getTime() < RELATIVE_WINDOW_MS;

  return (
    <time
      dateTime={value}
      title={`${fullDate.format(date)} UTC`}
      className={cn("whitespace-nowrap text-xs text-muted-foreground tabular-nums", className)}
    >
      {isRecent ? formatRelativeTime(value) : shortDate.format(date)}
    </time>
  );
}
