import {
  BookOpenIcon as BookOpen,
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  LinkIcon as Link2,
  ArrowsClockwiseIcon as RefreshCw,
} from "@phosphor-icons/react/ssr";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

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
  signedInAccountId,
  isLinking,
  isChecking,
  canCheck,
  onLink,
  onCheck,
}: {
  requiredAccountId: string;
  signedInAccountId: string | null;
  isLinking: boolean;
  isChecking: boolean;
  canCheck: boolean;
  onLink: () => void;
  onCheck: () => void;
}) {
  if (signedInAccountId && signedInAccountId !== requiredAccountId) {
    return (
      <div className="space-y-1 rounded-md border border-border bg-background p-3 text-sm">
        <p className="font-medium text-foreground">Sign in as {requiredAccountId} to continue</p>
        <p className="text-muted-foreground">
          Only {requiredAccountId} can link this source, and you are signed in as{" "}
          {signedInAccountId}. Sign out and sign back in with {requiredAccountId}, then come back to
          this page.
        </p>
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
    <div className="flex flex-wrap gap-2">
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
  onDismiss,
}: {
  revealedSecret: string | null;
  eventType: string | null;
  actor: string;
  onDismiss: () => void;
}) {
  const guideLink = (
    <Button asChild size="sm" variant="outline">
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
          <CheckCircle className="size-6 shrink-0 text-primary" weight="fill" />
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
        <CheckCircle className="mt-0.5 size-6 shrink-0 text-primary" weight="fill" />
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Send your first event</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => copyText(command, "Command")}
            >
              <Copy />
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
            {command}
          </pre>
          <p className="text-xs text-muted-foreground">
            Run it from a terminal. It should return an event ID, and the event appears in the
            Activity feed.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onDismiss}>
          I saved my key
        </Button>
        {guideLink}
      </div>
    </Card>
  );
}
