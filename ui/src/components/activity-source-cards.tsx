import { Check, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type {
  ActivitySourceView,
  ReviewActivitySourceInput,
} from "@/components/activity-sources-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const statusLabel: Record<ActivitySourceView["approvalStatus"], string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export function ActivitySourceCard({
  source,
  credentials,
}: {
  source: ActivitySourceView;
  credentials?: ReactNode;
}) {
  const statusVariant = source.approvalStatus === "rejected" ? "destructive" : "secondary";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-semibold text-foreground">{source.displayName}</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {source.sourceId} · {source.nearAccountId}
          </p>
        </div>
        <Badge variant={statusVariant}>{statusLabel[source.approvalStatus]}</Badge>
      </div>

      <div className="mt-5 space-y-2">
        {source.eventTypes.map((eventType) => (
          <div
            key={eventType.name}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs"
          >
            <div>
              <div className="font-mono text-foreground">{eventType.name}</div>
              <div className="text-muted-foreground">{eventType.description}</div>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{eventType.pointValue} points</span>
              <span>{eventType.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
        ))}
      </div>

      {source.reviewReason && (
        <p className="mt-4 rounded-[8px] bg-muted p-3 text-xs text-muted-foreground">
          Review: {source.reviewReason}
        </p>
      )}

      {credentials}
    </Card>
  );
}

export function ActivitySourceReviewCard({
  source,
  isSubmitting,
  onReview,
}: {
  source: ActivitySourceView;
  isSubmitting: boolean;
  onReview: (input: ReviewActivitySourceInput) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");

  const submitReview = async (decision: ReviewActivitySourceInput["decision"]) => {
    try {
      await onReview({ sourceId: source.sourceId, decision, reason });
    } catch {
      return;
    }
    setReason("");
  };

  return (
    <Card className="p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <ActivitySourceCardContent source={source} />
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`review-${source.sourceId}`}>Auditable review reason</Label>
            <Textarea
              id={`review-${source.sourceId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Record why this source is approved or rejected"
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || reason.trim().length === 0}
              onClick={() => submitReview("approved")}
            >
              <Check />
              Approve source
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isSubmitting || reason.trim().length === 0}
              onClick={() => submitReview("rejected")}
            >
              <X />
              Reject source
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ActivitySourceCardContent({ source }: { source: ActivitySourceView }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-foreground">{source.displayName}</h3>
        <p className="font-mono text-xs text-muted-foreground">
          {source.sourceId} · {source.nearAccountId}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          Organization {source.organizationId}
        </p>
      </div>
      <div className="space-y-1">
        {source.eventTypes.map((eventType) => (
          <div key={eventType.name} className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{eventType.name}</span>
            {` · ${eventType.pointValue} points · ${eventType.enabled ? "enabled" : "disabled"}`}
          </div>
        ))}
      </div>
    </div>
  );
}
