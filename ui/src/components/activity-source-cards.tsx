import { CheckIcon as Check, XIcon as X } from "@phosphor-icons/react/ssr";
import { type ReactNode, useState } from "react";
import type {
  ActivitySourceView,
  ReviewActivitySourceInput,
} from "@/components/activity-sources-model";
import { ActivityTrustBadge } from "@/components/ui/activity-trust-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const statusLabel: Record<ActivitySourceView["approvalStatus"], string> = {
  pending: "Under review",
  approved: "Approved",
  rejected: "Rejected",
};

export interface ActivitySourceCardTab {
  value: string;
  label: string;
  content: ReactNode;
}

export function ActivitySourceCard({
  source,
  tabs,
  health,
  showPendingNotice = true,
}: {
  source: ActivitySourceView;
  tabs?: ActivitySourceCardTab[] | null;
  health?: ReactNode;
  showPendingNotice?: boolean;
}) {
  const statusVariant = source.approvalStatus === "rejected" ? "destructive" : "secondary";

  const eventTypes = (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {source.eventTypes.map((eventType) => (
        <li
          key={eventType.name}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="font-mono text-sm text-foreground">{eventType.name}</p>
            {eventType.description && (
              <p className="text-xs text-muted-foreground">{eventType.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!eventType.enabled && <Badge variant="outline">Disabled</Badge>}
            <Badge variant="secondary">{eventType.pointValue} points</Badge>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <Card className="gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{source.displayName}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {source.sourceId} · {source.nearAccountId}
          </p>
          {health}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant}>{statusLabel[source.approvalStatus]}</Badge>
          <ActivityTrustBadge
            trustStatus={source.trustStatus}
            scoreMultiplier={source.scoreMultiplier}
            standardLabel="Standard weighting"
          />
        </div>
      </div>

      {source.approvalStatus === "pending" && showPendingNotice && (
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm font-medium text-foreground">Under review</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can already send events. They appear in the feed marked "Under review" and start
            counting on the leaderboard once a Platform Administrator approves this source.
          </p>
        </div>
      )}

      {source.reviewReason && source.approvalStatus === "rejected" && (
        <p className="rounded-lg bg-muted p-4 text-sm text-foreground">
          Reviewer: {source.reviewReason}
        </p>
      )}

      {tabs && tabs.length > 0 ? (
        <Tabs defaultValue="event-types" className="gap-4">
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto border-b border-border"
          >
            <TabsTrigger value="event-types" className="flex-none">
              Event types
            </TabsTrigger>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-none">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="event-types">{eventTypes}</TabsContent>
          {tabs.map((tab) => (
            <TabsContent
              key={tab.value}
              value={tab.value}
              forceMount
              className="data-[state=inactive]:hidden"
            >
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        eventTypes
      )}
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
    <Card className="gap-5 border-brand-accent-border/60 p-5">
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
        <p className="mt-1 text-xs text-muted-foreground">
          {source.trustStatus === "trusted"
            ? `Trusted weighting · ${source.scoreMultiplier}×`
            : "Standard weighting · 1×"}
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
