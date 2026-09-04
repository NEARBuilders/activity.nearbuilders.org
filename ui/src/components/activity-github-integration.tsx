import { GitPullRequest, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ActivityGithubConfigurationView {
  sourceId: string;
  enabled: boolean;
  mergedPullRequestsEnabled: boolean;
  closedIssuesEnabled: boolean;
  tokenConfigured: boolean;
  repositories: Array<{
    owner: string;
    repository: string;
    etag: string | null;
    pollIntervalSeconds: number;
    nextPollAt: string | null;
    lastPolledAt: string | null;
    lastError: string | null;
  }>;
  actorMappings: Array<{ githubLogin: string; nearAccountId: string }>;
  quarantineCount: number;
}

export interface ActivityGithubConfigurationInput {
  enabled: boolean;
  mergedPullRequestsEnabled: boolean;
  closedIssuesEnabled: boolean;
  repositories: Array<{ owner: string; repository: string }>;
  actorMappings: Array<{ githubLogin: string; nearAccountId: string }>;
}

interface ActivityGithubIntegrationProps {
  sourceId: string;
  configuration: ActivityGithubConfigurationView | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onSave: (input: ActivityGithubConfigurationInput) => void | Promise<void>;
  onPoll: () => void | Promise<void>;
}

export function ActivityGithubIntegration({
  sourceId,
  configuration,
  isLoading,
  isSubmitting,
  onSave,
  onPoll,
}: ActivityGithubIntegrationProps) {
  const [enabled, setEnabled] = useState(configuration?.enabled ?? false);
  const [mergedPullRequestsEnabled, setMergedPullRequestsEnabled] = useState(
    configuration?.mergedPullRequestsEnabled ?? true,
  );
  const [closedIssuesEnabled, setClosedIssuesEnabled] = useState(
    configuration?.closedIssuesEnabled ?? true,
  );
  const [repositories, setRepositories] = useState(serializeRepositories(configuration));
  const [actorMappings, setActorMappings] = useState(serializeMappings(configuration));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!configuration) return;
    setEnabled(configuration.enabled);
    setMergedPullRequestsEnabled(configuration.mergedPullRequestsEnabled);
    setClosedIssuesEnabled(configuration.closedIssuesEnabled);
    setRepositories(serializeRepositories(configuration));
    setActorMappings(serializeMappings(configuration));
  }, [configuration]);

  const save = async () => {
    try {
      const parsedRepositories = parseRepositories(repositories);
      const parsedMappings = parseMappings(actorMappings);
      if (enabled && parsedRepositories.length === 0) {
        throw new Error("Add at least one public repository before enabling polling");
      }
      if (enabled && !mergedPullRequestsEnabled && !closedIssuesEnabled) {
        throw new Error("Enable merged pull requests, closed issues, or both");
      }
      setValidationError(null);
      await onSave({
        enabled,
        mergedPullRequestsEnabled,
        closedIssuesEnabled,
        repositories: parsedRepositories,
        actorMappings: parsedMappings,
      });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Invalid GitHub configuration");
    }
  };

  return (
    <div className="mt-5 space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <GitPullRequest className="size-4" />
          GitHub polling
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {configuration?.tokenConfigured ? "Token configured" : "Public API"}
          </Badge>
          {configuration && (
            <Badge variant={configuration.enabled ? "default" : "outline"}>
              {configuration.enabled ? "Enabled" : "Disabled"}
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          Loading GitHub configuration…
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Poll public repository events and credit them only after a GitHub login is explicitly
            mapped to a NEAR account.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <CheckboxField
              id={`github-enabled-${sourceId}`}
              label="Enable polling"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <CheckboxField
              id={`github-prs-${sourceId}`}
              label="Merged pull requests"
              checked={mergedPullRequestsEnabled}
              onCheckedChange={setMergedPullRequestsEnabled}
            />
            <CheckboxField
              id={`github-issues-${sourceId}`}
              label="Closed issues"
              checked={closedIssuesEnabled}
              onCheckedChange={setClosedIssuesEnabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`github-repositories-${sourceId}`}>Public repositories</Label>
              <Textarea
                id={`github-repositories-${sourceId}`}
                value={repositories}
                onChange={(event) => setRepositories(event.target.value)}
                placeholder={
                  "NEARBuilders/nearbuilders.org\nNEARBuilders/activity.nearbuilders.org"
                }
                rows={4}
              />
              <p className="text-xs text-muted-foreground">One owner/repository per line.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`github-mappings-${sourceId}`}>Actor mappings</Label>
              <Textarea
                id={`github-mappings-${sourceId}`}
                value={actorMappings}
                onChange={(event) => setActorMappings(event.target.value)}
                placeholder={"github-login=alice.near\nmaintainer=bob.near"}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                One GitHub login=NEAR account per line.
              </p>
            </div>
          </div>

          {validationError && (
            <p className="text-xs text-destructive" role="alert">
              {validationError}
            </p>
          )}

          {configuration && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
              <p>{configuration.quarantineCount} unmapped events quarantined</p>
              {configuration.repositories.map((repository) => (
                <div key={`${repository.owner}/${repository.repository}`}>
                  <span className="font-mono text-foreground">
                    {repository.owner}/{repository.repository}
                  </span>
                  {repository.lastError
                    ? ` · ${repository.lastError}`
                    : repository.lastPolledAt
                      ? ` · last checked ${new Date(repository.lastPolledAt).toLocaleString()}`
                      : " · not polled yet"}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={save} disabled={isSubmitting}>
              <Save />
              Save GitHub settings
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onPoll}
              disabled={isSubmitting || !configuration?.enabled}
            >
              <RefreshCw />
              Poll now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function serializeRepositories(configuration: ActivityGithubConfigurationView | null): string {
  return (
    configuration?.repositories
      .map(({ owner, repository }) => `${owner}/${repository}`)
      .join("\n") ?? ""
  );
}

function serializeMappings(configuration: ActivityGithubConfigurationView | null): string {
  return (
    configuration?.actorMappings
      .map(({ githubLogin, nearAccountId }) => `${githubLogin}=${nearAccountId}`)
      .join("\n") ?? ""
  );
}

function parseRepositories(value: string): Array<{ owner: string; repository: string }> {
  return nonEmptyLines(value).map((line) => {
    const parts = line.split("/");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new Error(`Invalid repository “${line}”; use owner/repository`);
    }
    return { owner: parts[0].trim(), repository: parts[1].trim() };
  });
}

function parseMappings(value: string): Array<{ githubLogin: string; nearAccountId: string }> {
  return nonEmptyLines(value).map((line) => {
    const separator = line.indexOf("=");
    const githubLogin = line.slice(0, separator).trim();
    const nearAccountId = line.slice(separator + 1).trim();
    if (separator < 1 || !githubLogin || !nearAccountId) {
      throw new Error(`Invalid actor mapping “${line}”; use github-login=account.near`);
    }
    return { githubLogin, nearAccountId };
  });
}

function nonEmptyLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
