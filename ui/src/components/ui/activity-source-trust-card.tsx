import { useState } from "react";
import type {
  ActivitySourceView,
  UpdateActivitySourceTrustInput,
} from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ActivitySourceTrustCard({
  source,
  isSubmitting,
  onTrust,
}: {
  source: ActivitySourceView;
  isSubmitting: boolean;
  onTrust: (input: UpdateActivitySourceTrustInput) => void | Promise<void>;
}) {
  const [trustStatus, setTrustStatus] = useState(source.trustStatus);
  const [scoreMultiplier, setScoreMultiplier] = useState(String(source.scoreMultiplier));
  const [reason, setReason] = useState("");
  const designationId = `trust-designation-${source.sourceId}`;
  const multiplierId = `trust-multiplier-${source.sourceId}`;
  const reasonId = `trust-reason-${source.sourceId}`;

  const submitTrust = async () => {
    try {
      await onTrust({
        sourceId: source.sourceId,
        trustStatus,
        scoreMultiplier: trustStatus === "standard" ? 1 : Number(scoreMultiplier),
        reason,
      });
    } catch {
      return;
    }
    setReason("");
  };

  return (
    <Card className="p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div>
            <h3 className="font-semibold text-foreground">{source.displayName}</h3>
            <p className="font-mono text-xs text-muted-foreground">
              {source.sourceId} · {source.nearAccountId}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Organization {source.organizationId}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Approval: {source.approvalStatus} · Current weighting: {source.scoreMultiplier}×
          </p>
        </div>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={designationId}>Trust designation for {source.sourceId}</Label>
              <select
                id={designationId}
                className="h-9 w-full rounded-[8px] border border-input bg-background px-3 text-sm text-foreground"
                value={trustStatus}
                onChange={(event) => {
                  const next = event.target.value as UpdateActivitySourceTrustInput["trustStatus"];
                  setTrustStatus(next);
                  if (next === "standard") setScoreMultiplier("1");
                }}
              >
                <option value="standard">Standard</option>
                <option value="trusted">Trusted</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={multiplierId}>Score multiplier for {source.sourceId}</Label>
              <Input
                id={multiplierId}
                type="number"
                min="1"
                max="10"
                step="0.0001"
                value={scoreMultiplier}
                disabled={trustStatus === "standard"}
                onChange={(event) => setScoreMultiplier(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Auditable trust reason for {source.sourceId}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Record why this weighting is appropriate"
              required
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={
              isSubmitting ||
              reason.trim().length === 0 ||
              (trustStatus === "trusted" &&
                (!Number.isFinite(Number(scoreMultiplier)) ||
                  Number(scoreMultiplier) < 1 ||
                  Number(scoreMultiplier) > 10))
            }
            onClick={submitTrust}
          >
            Save trust for {source.sourceId}
          </Button>
          {source.trustHistory.length > 0 && (
            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Trust history</p>
              {source.trustHistory.map((change) => (
                <p key={`${change.changedAt}-${change.administratorId}`}>
                  {change.trustStatus} · {change.scoreMultiplier}× · {change.reason} ·{" "}
                  {change.administratorId}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
