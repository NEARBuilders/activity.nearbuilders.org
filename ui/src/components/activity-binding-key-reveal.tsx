import {
  BookOpenIcon as BookOpen,
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  KeyIcon as Key,
  RobotIcon as Robot,
  TerminalWindowIcon as TerminalWindow,
  WarningIcon as Warning,
} from "@phosphor-icons/react/ssr";
import { Link } from "@tanstack/react-router";
import { copyText } from "@/components/activity-setup-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export const ACTIVITY_TEST_EVENT_TYPE = "activity.test";

export function buildConnectionTestCommand(input: { apiBaseUrl: string; actor: string }) {
  const body = JSON.stringify({
    eventType: ACTIVITY_TEST_EVENT_TYPE,
    actor: input.actor,
    idempotencyKey: "connection-test",
    payload: {},
  });
  return [
    `curl -X POST ${input.apiBaseUrl}/v1/events \\`,
    `  -H "Authorization: Bearer $ACTIVITY_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}'`,
  ].join("\n");
}

export function buildAgentPrompt(input: {
  siteUrl: string;
  sourceId: string;
  eventTypes: Array<{ name: string; pointValue: number }>;
}) {
  const eventList = input.eventTypes
    .map(({ name, pointValue }) => `- ${name} (${pointValue} points)`)
    .join("\n");
  return [
    `Integrate activity.nearbuilders.org into this project so it reports what users do.`,
    ``,
    `Activity Source ID: ${input.sourceId}`,
    `Event types to report:`,
    eventList,
    ``,
    `- Read the Source API Key from the ACTIVITY_API_KEY environment variable on the server. Never hard-code it, log it, or send it to the browser.`,
    `- Send each event from server-side code with POST ${input.siteUrl}/api/v1/events, using "Authorization: Bearer <ACTIVITY_API_KEY>".`,
    `- The event's actor is the NEAR account ID of the user who did the action. Only report actions where you know it.`,
    `- Give every event a stable idempotencyKey, such as "<event>:<record id>", so retries never double count.`,
    ``,
    `Follow ${input.siteUrl}/skill.md and ${input.siteUrl}/docs/integration-guide for the full details.`,
  ].join("\n");
}

function CopyBlock({
  label,
  icon,
  text,
  copyLabel,
}: {
  label: string;
  icon: "terminal" | "agent";
  text: string;
  copyLabel: string;
}) {
  const Icon = icon === "terminal" ? TerminalWindow : Robot;
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-muted">
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label={`Copy ${copyLabel.toLowerCase()}`}
          onClick={() => copyText(text, copyLabel)}
        >
          <Copy />
          Copy
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function ActivityBindingKeyReveal({
  status,
  sourceId,
  actor,
  eventTypes,
  apiBaseUrl,
  siteUrl,
  secret,
  isRevealing,
  connectionWorks,
  onReveal,
}: {
  status: "ready" | "claimed";
  sourceId: string;
  actor: string;
  eventTypes: Array<{ name: string; pointValue: number }>;
  apiBaseUrl: string;
  siteUrl: string;
  secret: string | null;
  isRevealing: boolean;
  connectionWorks: boolean;
  onReveal: () => void;
}) {
  const links = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button asChild variant="outline" size="sm">
        <Link to="/activity" search={{ source: sourceId }}>
          View activity
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link to="/activity-sources">Manage keys and points</Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link to="/docs/$slug" params={{ slug: "integration-guide" }}>
          <BookOpen />
          Integration guide
        </Link>
      </Button>
    </div>
  );

  if (!secret && status === "claimed") {
    return (
      <Card className="gap-3 p-5" aria-label="API key already shown">
        <div className="flex items-center gap-2">
          <Warning className="size-5 text-muted-foreground" />
          <h1 className="text-base font-semibold text-foreground">
            Your API key was already shown
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          For safety it is shown only once. If you lost it, create a new key for {sourceId} on the
          Activity Sources page and revoke the old one.
        </p>
        {links}
      </Card>
    );
  }

  if (!secret) {
    return (
      <Card className="gap-4 p-5" aria-label="Show your API key">
        <div className="flex items-start gap-3">
          <CheckCircle className="mt-0.5 size-6 shrink-0 text-brand-accent" weight="fill" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold text-foreground">{sourceId} is linked</h1>
            <p className="text-sm text-muted-foreground">
              Your API key is shown once, on the next screen. Have somewhere safe ready to keep it,
              such as your server's secret manager.
            </p>
          </div>
        </div>
        <div>
          <Button type="button" onClick={onReveal} disabled={isRevealing}>
            <Key />
            {isRevealing ? "Creating your key…" : "Show my API key"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="gap-6 p-4 sm:p-5" aria-label="Activity connected">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 size-6 shrink-0 text-brand-accent" weight="fill" />
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-foreground">Activity is connected</h1>
          <p className="text-sm text-muted-foreground">
            {sourceId} is under review. Its events show in the feed now and start counting on the
            leaderboard once an administrator approves it.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="binding-api-key">Your API key</Label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input id="binding-api-key" readOnly value={secret} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => copyText(secret, "API key")}>
            <Copy />
            Copy key
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This is the only time it is shown. Store it as the ACTIVITY_API_KEY secret on your server.
          If you lose it, create a new one on the Activity Sources page.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Test the connection</p>
            <p className="text-xs text-muted-foreground">
              Set ACTIVITY_API_KEY in your terminal, then run this. Test events never appear in the
              feed or count for points.
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            role="status"
          >
            {connectionWorks ? (
              <>
                <CheckCircle className="size-4 text-brand-accent" weight="fill" />
                Connection works
              </>
            ) : (
              <>
                <Spinner className="size-3.5 text-muted-foreground" />
                Waiting for the test event
              </>
            )}
          </span>
        </div>
        <CopyBlock
          label="Terminal"
          icon="terminal"
          text={buildConnectionTestCommand({ apiBaseUrl, actor })}
          copyLabel="Command"
        />
      </div>

      <div className="space-y-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Hand it to your coding agent</p>
          <p className="text-xs text-muted-foreground">
            Paste this into Claude Code, Cursor, or another agent. It does not include your key.
          </p>
        </div>
        <CopyBlock
          label="Agent prompt"
          icon="agent"
          text={buildAgentPrompt({ siteUrl, sourceId, eventTypes })}
          copyLabel="Prompt"
        />
      </div>

      {links}
    </Card>
  );
}
