import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ActivityTrustBadge({
  trustStatus,
  scoreMultiplier,
  standardLabel = "Standard source",
  className,
}: {
  trustStatus: "standard" | "trusted";
  scoreMultiplier: number;
  standardLabel?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        trustStatus === "trusted"
          ? "border-brand-accent/40 bg-brand-accent/10 text-foreground"
          : "text-muted-foreground",
        className,
      )}
    >
      {trustStatus === "trusted" ? `Trusted · ${scoreMultiplier}×` : standardLabel}
    </Badge>
  );
}
