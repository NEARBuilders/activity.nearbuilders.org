import {
  CheckIcon as Check,
  HourglassIcon as Hourglass,
  PencilSimpleIcon as PencilSimple,
  XIcon as X,
} from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ActivityOnboardingStep,
  ActivityOnboardingStepId,
  ActivityOnboardingStepStatus,
} from "@/lib/activity-onboarding";
import { cn } from "@/lib/utils";

const stepLabel: Record<ActivityOnboardingStepId, string> = {
  near: "Connect NEAR",
  organization: "Organization",
  register: "Info",
  binding: "Link on-chain",
  "api-key": "API key",
};

interface StepGuide {
  title: string;
  description: (nearAccountId: string | null) => string;
}

const stepGuide: Record<ActivityOnboardingStepId, StepGuide> = {
  near: {
    title: "Connect your NEAR wallet",
    description: () =>
      "Sign in with the mainnet NEAR account that will own your source. You will use it once more to link the source on-chain.",
  },
  organization: {
    title: "Choose an organization you own",
    description: () =>
      "A source belongs to one organization for good. Pick one you own, or create a new one.",
  },
  register: {
    title: "Register your source",
    description: () =>
      "Tell us what your source is and which events it will send. An administrator reviews it in the background, so you can keep going.",
  },
  binding: {
    title: "Link your source on-chain",
    description: (nearAccountId) =>
      `Approve one transaction from ${nearAccountId ?? "your source's NEAR account"} to prove the source belongs to it. It costs well under 0.001 NEAR.`,
  },
  "api-key": {
    title: "Create your API key",
    description: () =>
      "Your app uses this key to send events. The secret is shown once, so have somewhere safe to keep it.",
  },
};

const hiddenSteps = new Set<ActivityOnboardingStepId>(["near", "organization"]);

const editableSteps = new Set<ActivityOnboardingStepId>(["register"]);

const editGuide: StepGuide = {
  title: "Edit your source info",
  description: () =>
    "The Source ID is permanent. Changing the NEAR account means linking the source on-chain again.",
};

const rejectedGuide: StepGuide = {
  title: "Your source was rejected",
  description: () =>
    "Read the reviewer's reason below, then register a new source that addresses it.",
};

export function ActivityOnboardingProgress({
  steps,
  nearAccountId,
  action,
  complete,
  title,
  onCancel,
  editingStepId = null,
  onEditStep,
}: {
  steps: ActivityOnboardingStep[];
  nearAccountId: string | null;
  action?: ReactNode;
  complete?: ReactNode;
  title?: string;
  onCancel?: () => void;
  editingStepId?: ActivityOnboardingStepId | null;
  onEditStep?: (id: ActivityOnboardingStepId) => void;
}) {
  const activeStep = steps.find((step) => step.status !== "complete");

  if (!activeStep && !editingStepId) {
    return complete ?? null;
  }

  const visibleSteps = steps.filter((step) => !hiddenSteps.has(step.id));
  const focusIndex = Math.max(
    0,
    visibleSteps.findIndex((step) =>
      editingStepId ? step.id === editingStepId : step.status !== "complete",
    ),
  );
  const focusStep = visibleSteps[focusIndex];
  const guide = editingStepId
    ? editGuide
    : activeStep?.status === "blocked"
      ? rejectedGuide
      : stepGuide[activeStep?.id ?? "register"];
  const editableStep =
    onEditStep && !editingStepId
      ? visibleSteps.find((step) => step.status === "complete" && editableSteps.has(step.id))
      : undefined;
  const displayStatus = (step: ActivityOnboardingStep): ActivityOnboardingStepStatus =>
    step.id === editingStepId ? "current" : step.status;

  return (
    <Card className="gap-4 p-4 sm:p-5" aria-label="Setup progress">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">
          Setup · Step {focusIndex + 1} of {visibleSteps.length}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-foreground md:hidden">
            {focusStep ? stepLabel[focusStep.id] : null}
          </p>
          {editableStep && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onEditStep?.(editableStep.id)}
            >
              <PencilSimple />
              Edit {stepLabel[editableStep.id].toLowerCase()}
            </Button>
          )}
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              <X />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 md:hidden" aria-hidden="true">
        {visibleSteps.map((step) => (
          <div
            key={step.id}
            className={cn("h-1.5 flex-1 rounded-full", segmentClass[displayStatus(step)])}
          />
        ))}
      </div>

      <ol className="hidden items-start md:flex">
        {visibleSteps.map((step, index) => {
          const status = displayStatus(step);
          const label = (
            <>
              <StepMarker status={status} index={index} />
              <span
                className={cn(
                  "text-xs",
                  status === "upcoming" ? "text-muted-foreground" : "text-foreground",
                  index === focusIndex && "font-semibold",
                )}
              >
                {stepLabel[step.id]}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              aria-current={index === focusIndex ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center gap-2 text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-3.5 right-1/2 h-px w-full",
                    visibleSteps[index - 1].status === "complete" ? "bg-brand-accent" : "bg-border",
                  )}
                />
              )}
              {editableStep?.id === step.id ? (
                <button
                  type="button"
                  onClick={() => onEditStep?.(step.id)}
                  aria-label={`Edit ${stepLabel[step.id].toLowerCase()}`}
                  className="relative z-10 flex flex-col items-center gap-2 rounded-md hover:opacity-80"
                >
                  {label}
                </button>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ol>

      <div className="space-y-4 sm:rounded-lg sm:bg-muted sm:p-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            {editingStepId ? guide.title : (title ?? guide.title)}
          </h2>
          <p className="text-sm text-muted-foreground">{guide.description(nearAccountId)}</p>
        </div>
        {action}
      </div>
    </Card>
  );
}

const segmentClass: Record<ActivityOnboardingStepStatus, string> = {
  complete: "bg-brand-accent",
  current: "bg-brand-accent/50",
  waiting: "bg-brand-accent/50",
  blocked: "bg-destructive",
  upcoming: "bg-border",
};

function StepMarker({ status, index }: { status: ActivityOnboardingStepStatus; index: number }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        status === "complete" && "border-brand-accent bg-brand-accent text-brand-accent-foreground",
        status === "current" &&
          "border-brand-accent bg-background text-foreground ring-2 ring-brand-accent/30",
        status === "waiting" && "border-brand-accent bg-background text-foreground",
        status === "blocked" && "border-destructive bg-background text-destructive",
        status === "upcoming" && "border-border bg-background text-muted-foreground",
      )}
    >
      {status === "complete" ? (
        <Check className="size-3.5" weight="bold" />
      ) : status === "waiting" ? (
        <Hourglass className="size-3.5" />
      ) : status === "blocked" ? (
        <X className="size-3.5" weight="bold" />
      ) : (
        index + 1
      )}
    </span>
  );
}
