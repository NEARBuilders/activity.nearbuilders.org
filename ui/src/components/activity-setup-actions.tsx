import {
  BookOpenIcon as BookOpen,
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  LinkIcon as Link2,
  ArrowsClockwiseIcon as RefreshCw,
  TerminalWindowIcon as TerminalWindow,
  WalletIcon as Wallet,
} from "@phosphor-icons/react/ssr";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/relative-time";

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Failed to copy ${label.toLowerCase()}`);
  }
}

export function ActivityLinkOnChainAction({
  requiredAccountId,
  linkedAccountIds,
  isLinking,
  isChecking,
  isLinkingAccount,
  canCheck,
  onLink,
  onCheck,
  onLinkAccount,
}: {
  requiredAccountId: string;
  linkedAccountIds: string[];
  isLinking: boolean;
  isChecking: boolean;
  isLinkingAccount: boolean;
  canCheck: boolean;
  onLink: () => void;
  onCheck: () => void;
  onLinkAccount: () => void;
}) {
  if (linkedAccountIds.length > 0 && !linkedAccountIds.includes(requiredAccountId)) {
    return (
      <div className="space-y-3 rounded-md border border-border bg-background p-3 text-sm">
        <div className="space-y-1">
          <p className="font-medium text-foreground">Add {requiredAccountId} to your profile</p>
          <p className="text-muted-foreground">
            Only {requiredAccountId} can link this source, and your profile has{" "}
            {linkedAccountIds.join(", ")}. Add {requiredAccountId} by signing one message with it;
            you stay signed in and keep this organization.
          </p>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={onLinkAccount}
          disabled={isLinkingAccount}
        >
          <Wallet />
          {isLinkingAccount ? "Waiting for wallet..." : `Add ${requiredAccountId}`}
        </Button>
      </div>
    );
  }

  if (isLinking) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Spinner className="size-4" />
        Approve the transaction in your wallet. This finishes on its own once it is confirmed.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button type="button" onClick={onLink} disabled={isChecking}>
        <Link2 />
        Approve in wallet
      </Button>
      {canCheck && (
        <Button type="button" variant="outline" onClick={onCheck} disabled={isChecking}>
          <RefreshCw />
          {isChecking ? "Checking..." : "I already approved it"}
        </Button>
      )}
    </div>
  );
}

export function ActivityApiKeyAction({
  isSubmitting,
  onCreate,
}: {
  isSubmitting: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("Production");

  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed) onCreate(trimmed);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="setup-api-key-name">Key name</Label>
        <Input
          id="setup-api-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="bg-background"
        />
      </div>
      <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
        {isSubmitting ? "Creating..." : "Create API key"}
      </Button>
    </form>
  );
}

export function buildFirstEventCommand(input: {
  apiBaseUrl: string;
  secret: string;
  eventType: string;
  actor: string;
}) {
  const body = JSON.stringify({
    eventType: input.eventType,
    actor: input.actor,
    idempotencyKey: "first-event",
    payload: {},
  });
  return [
    `curl -X POST ${input.apiBaseUrl}/v1/events \\`,
    `  -H "Authorization: Bearer ${input.secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}'`,
  ].join("\n");
}

export function ActivitySetupComplete({
  revealedSecret,
  eventType,
  actor,
  firstEvent,
  onDismiss,
}: {
  revealedSecret: string | null;
  eventType: string | null;
  actor: string;
  firstEvent?: { type: string; timestamp: string } | null;
  onDismiss: () => void;
}) {
  const guideLink = (
    <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
      <Link to="/docs/$slug" params={{ slug: "integration-guide" }}>
        <BookOpen />
        Integration guide
      </Link>
    </Button>
  );

  if (!revealedSecret) {
    return (
      <Card className="flex-row flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="size-6 shrink-0 text-brand-accent" weight="fill" />
          <div>
            <p className="text-sm font-semibold text-foreground">Setup complete</p>
            <p className="text-xs text-muted-foreground">
              Send events to the API with your Source API Key.
            </p>
          </div>
        </div>
        {guideLink}
      </Card>
    );
  }

  const apiBaseUrl = `${typeof window === "undefined" ? "" : window.location.origin}/api`;
  const command = eventType
    ? buildFirstEventCommand({ apiBaseUrl, secret: revealedSecret, eventType, actor })
    : null;

  return (
    <Card className="gap-5 p-4 sm:p-5" aria-label="Setup complete">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 size-6 shrink-0 text-brand-accent" weight="fill" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">You're ready to send events</h2>
          <p className="text-sm text-muted-foreground">
            Copy your API key now. It is not shown again after you leave this page.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setup-api-key-secret">Your API key</Label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            id="setup-api-key-secret"
            readOnly
            value={revealedSecret}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => copyText(revealedSecret, "API key")}
          >
            <Copy />
            Copy key
          </Button>
        </div>
      </div>

      {command && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Send your first event</p>
            <p className="text-xs text-muted-foreground">
              Run this from a terminal. It returns an event ID, and the status below updates.
            </p>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-border bg-muted">
            <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <TerminalWindow className="size-3.5" />
                Terminal
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label="Copy command"
                onClick={() => copyText(command, "Command")}
              >
                <Copy />
                Copy
              </Button>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
              <code>{command}</code>
            </pre>
          </div>
        </div>
      )}

      {firstEvent !== undefined && <FirstEventStatus firstEvent={firstEvent} />}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onDismiss}>
          I saved my key
        </Button>
        {guideLink}
      </div>
    </Card>
  );
}

function FirstEventStatus({
  firstEvent,
}: {
  firstEvent: { type: string; timestamp: string } | null;
}) {
  if (!firstEvent) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <Spinner className="size-4" />
        Waiting for your first event. This updates on its own once it arrives.
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-accent/40 bg-brand-accent/5 p-4"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <CheckCircle className="size-5 shrink-0 text-brand-accent" weight="fill" />
        <p className="text-sm text-foreground">
          First event received: <span className="font-mono">{firstEvent.type}</span>,{" "}
          {formatRelativeTime(firstEvent.timestamp)}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
        <Link to="/activity">View in feed</Link>
      </Button>
    </div>
  );
}
