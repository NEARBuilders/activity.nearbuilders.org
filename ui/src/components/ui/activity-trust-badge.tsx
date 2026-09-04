import { Badge } from "@/components/ui/badge";

export function ActivityTrustBadge({
  trustStatus,
  scoreMultiplier,
  standardLabel = "Standard source",
}: {
  trustStatus: "standard" | "trusted";
  scoreMultiplier: number;
  standardLabel?: string;
}) {
  return (
    <Badge variant={trustStatus === "trusted" ? "default" : "outline"}>
      {trustStatus === "trusted" ? `Trusted · ${scoreMultiplier}×` : standardLabel}
    </Badge>
  );
}
