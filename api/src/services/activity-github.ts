import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  activityEventTypes as eventTypesTable,
  activityGithubIntegrations as integrationsTable,
  activityGithubActorMappings as mappingsTable,
  activityGithubQuarantine as quarantineTable,
  activityGithubRepositories as repositoriesTable,
  activitySources as sourcesTable,
} from "../db/schema";
import {
  GitHubEventsClient,
  GitHubPollError,
  GitHubRepositoryNotPublicError,
} from "../github/github-events-client";
import type { ActivityIngestionService } from "./activity-ingestion";

export const GITHUB_MERGED_PULL_REQUEST_EVENT = "github.pr.merged";
export const GITHUB_CLOSED_ISSUE_EVENT = "github.issue.closed";

export type ActivityGithubConfiguration = {
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
};

export type ActivityGithubPollResult = {
  repositoriesPolled: number;
  notModified: number;
  published: number;
  quarantined: number;
  failed: number;
};

export type ActivityGithubQuarantineRecord = {
  id: string;
  githubEventId: string;
  repository: string;
  githubLogin: string;
  eventType: string;
  reason: string;
  createdAt: string;
};

type IntegrationRow = typeof integrationsTable.$inferSelect;
type RepositoryRow = typeof repositoriesTable.$inferSelect;

type GithubActivityCandidate = {
  githubEventId: string;
  eventType: typeof GITHUB_MERGED_PULL_REQUEST_EVENT | typeof GITHUB_CLOSED_ISSUE_EVENT;
  githubLogin: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export class ActivityGithubService {
  readonly #db: Database;
  readonly #client: GitHubEventsClient;
  readonly #ingestion: ActivityIngestionService;
  readonly #tokenConfigured: boolean;
  #timer?: ReturnType<typeof setInterval>;
  #polling = false;

  constructor(options: {
    db: Database;
    ingestion: ActivityIngestionService;
    client?: GitHubEventsClient;
    token?: string;
  }) {
    this.#db = options.db;
    this.#ingestion = options.ingestion;
    this.#tokenConfigured = Boolean(options.token);
    this.#client = options.client ?? new GitHubEventsClient({ token: options.token });
  }

  start(intervalMs = 30_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.pollDue().catch(() => {
        console.error("[ActivityGithub] Scheduled poll failed");
      });
    }, intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async configure(
    organizationId: string,
    sourceId: string,
    input: {
      enabled: boolean;
      mergedPullRequestsEnabled: boolean;
      closedIssuesEnabled: boolean;
      repositories: Array<{ owner: string; repository: string }>;
      actorMappings: Array<{ githubLogin: string; nearAccountId: string }>;
    },
  ): Promise<ActivityGithubConfiguration> {
    const source = await this.#ownedSource(organizationId, sourceId);
    const eventTypes = await this.#db
      .select({ name: eventTypesTable.name, enabled: eventTypesTable.enabled })
      .from(eventTypesTable)
      .where(eq(eventTypesTable.sourceRecordId, source.id));
    const enabledTypes = new Set(
      eventTypes.filter(({ enabled }) => enabled).map(({ name }) => name),
    );
    if (
      input.enabled &&
      input.mergedPullRequestsEnabled &&
      !enabledTypes.has(GITHUB_MERGED_PULL_REQUEST_EVENT)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Enable the ${GITHUB_MERGED_PULL_REQUEST_EVENT} Event Type on this Activity Source`,
      });
    }
    if (
      input.enabled &&
      input.closedIssuesEnabled &&
      !enabledTypes.has(GITHUB_CLOSED_ISSUE_EVENT)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Enable the ${GITHUB_CLOSED_ISSUE_EVENT} Event Type on this Activity Source`,
      });
    }
    if (input.enabled) {
      for (const repository of input.repositories) {
        try {
          await this.#client.assertPublicRepository(repository);
        } catch (error) {
          if (error instanceof GitHubRepositoryNotPublicError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: "GitHub repository validation is temporarily unavailable",
          });
        }
      }
    }

    await this.#db.transaction(async (tx) => {
      const [integration] = await tx
        .insert(integrationsTable)
        .values({
          sourceRecordId: source.id,
          enabled: input.enabled,
          mergedPullRequestsEnabled: input.mergedPullRequestsEnabled,
          closedIssuesEnabled: input.closedIssuesEnabled,
        })
        .onConflictDoUpdate({
          target: integrationsTable.sourceRecordId,
          set: {
            enabled: input.enabled,
            mergedPullRequestsEnabled: input.mergedPullRequestsEnabled,
            closedIssuesEnabled: input.closedIssuesEnabled,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!integration) throw new Error("GitHub integration was not saved");

      const repositories = input.repositories.map(({ owner, repository }) => ({
        owner: owner.toLowerCase(),
        repository: repository.toLowerCase(),
      }));
      const existingRepositories = await tx
        .select()
        .from(repositoriesTable)
        .where(eq(repositoriesTable.integrationId, integration.id));
      const keepRepositoryIds = existingRepositories
        .filter((existing) =>
          repositories.some(
            (repository) =>
              repository.owner === existing.owner && repository.repository === existing.repository,
          ),
        )
        .map(({ id }) => id);
      const removeRepositoryIds = existingRepositories
        .filter(({ id }) => !keepRepositoryIds.includes(id))
        .map(({ id }) => id);
      if (removeRepositoryIds.length > 0) {
        await tx
          .delete(repositoriesTable)
          .where(inArray(repositoriesTable.id, removeRepositoryIds));
      }
      for (const repository of repositories) {
        await tx
          .insert(repositoriesTable)
          .values({ integrationId: integration.id, ...repository })
          .onConflictDoNothing({
            target: [
              repositoriesTable.integrationId,
              repositoriesTable.owner,
              repositoriesTable.repository,
            ],
          });
      }

      const mappings = input.actorMappings.map(({ githubLogin, nearAccountId }) => ({
        githubLogin: githubLogin.toLowerCase(),
        nearAccountId,
      }));
      const existingMappings = await tx
        .select()
        .from(mappingsTable)
        .where(eq(mappingsTable.integrationId, integration.id));
      const removeMappingIds = existingMappings
        .filter(
          (existing) => !mappings.some(({ githubLogin }) => githubLogin === existing.githubLogin),
        )
        .map(({ id }) => id);
      if (removeMappingIds.length > 0) {
        await tx.delete(mappingsTable).where(inArray(mappingsTable.id, removeMappingIds));
      }
      for (const mapping of mappings) {
        await tx
          .insert(mappingsTable)
          .values({ integrationId: integration.id, ...mapping })
          .onConflictDoUpdate({
            target: [mappingsTable.integrationId, mappingsTable.githubLogin],
            set: { nearAccountId: mapping.nearAccountId, updatedAt: new Date() },
          });
      }
    });
    const configuration = await this.getConfiguration(organizationId, sourceId);
    if (!configuration) throw new Error("GitHub integration was not returned");
    return configuration;
  }

  async getConfiguration(
    organizationId: string,
    sourceId: string,
  ): Promise<ActivityGithubConfiguration | null> {
    const source = await this.#ownedSource(organizationId, sourceId);
    const [integration] = await this.#db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.sourceRecordId, source.id))
      .limit(1);
    if (!integration) return null;
    const [repositories, actorMappings, quarantine] = await Promise.all([
      this.#db
        .select()
        .from(repositoriesTable)
        .where(eq(repositoriesTable.integrationId, integration.id)),
      this.#db.select().from(mappingsTable).where(eq(mappingsTable.integrationId, integration.id)),
      this.#db
        .select({ id: quarantineTable.id })
        .from(quarantineTable)
        .where(eq(quarantineTable.integrationId, integration.id)),
    ]);
    return {
      sourceId,
      enabled: integration.enabled,
      mergedPullRequestsEnabled: integration.mergedPullRequestsEnabled,
      closedIssuesEnabled: integration.closedIssuesEnabled,
      tokenConfigured: this.#tokenConfigured,
      repositories: repositories.map((repository) => ({
        owner: repository.owner,
        repository: repository.repository,
        etag: repository.etag,
        pollIntervalSeconds: repository.pollIntervalSeconds,
        nextPollAt: iso(repository.nextPollAt),
        lastPolledAt: iso(repository.lastPolledAt),
        lastError: repository.lastError,
      })),
      actorMappings: actorMappings.map(({ githubLogin, nearAccountId }) => ({
        githubLogin,
        nearAccountId,
      })),
      quarantineCount: quarantine.length,
    };
  }

  async pollSource(organizationId: string, sourceId: string): Promise<ActivityGithubPollResult> {
    const source = await this.#ownedSource(organizationId, sourceId);
    const [integration] = await this.#db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.sourceRecordId, source.id))
      .limit(1);
    if (!integration) throw new ORPCError("NOT_FOUND", { message: "GitHub integration not found" });
    return this.#pollIntegration(sourceId, integration);
  }

  async listQuarantine(
    organizationId: string,
    sourceId: string,
  ): Promise<ActivityGithubQuarantineRecord[]> {
    const source = await this.#ownedSource(organizationId, sourceId);
    const [integration] = await this.#db
      .select({ id: integrationsTable.id })
      .from(integrationsTable)
      .where(eq(integrationsTable.sourceRecordId, source.id))
      .limit(1);
    if (!integration) return [];
    const records = await this.#db
      .select()
      .from(quarantineTable)
      .where(eq(quarantineTable.integrationId, integration.id))
      .orderBy(quarantineTable.createdAt)
      .limit(100);
    return records.map((record) => ({
      id: record.id,
      githubEventId: record.githubEventId,
      repository: record.repository,
      githubLogin: record.githubLogin,
      eventType: record.eventType,
      reason: record.reason,
      createdAt: iso(record.createdAt) ?? new Date(0).toISOString(),
    }));
  }

  async pollDue(now = new Date()): Promise<ActivityGithubPollResult> {
    if (this.#polling) return emptyPollResult();
    this.#polling = true;
    try {
      const due = await this.#db
        .select({ integration: integrationsTable, sourceId: sourcesTable.sourceId })
        .from(integrationsTable)
        .innerJoin(sourcesTable, eq(sourcesTable.id, integrationsTable.sourceRecordId))
        .innerJoin(repositoriesTable, eq(repositoriesTable.integrationId, integrationsTable.id))
        .where(
          and(
            eq(integrationsTable.enabled, true),
            or(isNull(repositoriesTable.nextPollAt), lte(repositoriesTable.nextPollAt, now)),
          ),
        );
      const integrations = [...new Map(due.map((row) => [row.integration.id, row])).values()];
      const total = emptyPollResult();
      for (const row of integrations) {
        mergePollResult(total, await this.#pollIntegration(row.sourceId, row.integration, now));
      }
      return total;
    } finally {
      this.#polling = false;
    }
  }

  async #pollIntegration(
    sourceId: string,
    integration: IntegrationRow,
    now = new Date(),
  ): Promise<ActivityGithubPollResult> {
    if (!integration.enabled) return emptyPollResult();
    const [repositories, mappings] = await Promise.all([
      this.#db
        .select()
        .from(repositoriesTable)
        .where(eq(repositoriesTable.integrationId, integration.id)),
      this.#db.select().from(mappingsTable).where(eq(mappingsTable.integrationId, integration.id)),
    ]);
    const actorByLogin = new Map(
      mappings.map(({ githubLogin, nearAccountId }) => [githubLogin, nearAccountId]),
    );
    const result = emptyPollResult();
    await this.#replayQuarantine(sourceId, integration, actorByLogin, result);
    for (const repository of repositories) {
      if (repository.nextPollAt && repository.nextPollAt > now) continue;
      result.repositoriesPolled += 1;
      await this.#pollRepository(sourceId, integration, repository, actorByLogin, result, now);
    }
    return result;
  }

  async #pollRepository(
    sourceId: string,
    integration: IntegrationRow,
    repository: RepositoryRow,
    actorByLogin: Map<string, string>,
    result: ActivityGithubPollResult,
    now: Date,
  ): Promise<void> {
    try {
      const response = await this.#client.pollRepository({
        owner: repository.owner,
        repository: repository.repository,
        etag: repository.etag,
      });
      const nextPollAt = new Date(now.getTime() + response.pollIntervalSeconds * 1_000);
      if (response.status === "not_modified") {
        result.notModified += 1;
      } else {
        const candidates = response.events.flatMap((event) =>
          candidateFromEvent(event, repository.owner, repository.repository, integration),
        );
        for (const candidate of candidates.reverse()) {
          await this.#deliverCandidate(sourceId, integration.id, candidate, actorByLogin, result);
        }
      }
      await this.#db
        .update(repositoriesTable)
        .set({
          etag: response.etag,
          pollIntervalSeconds: response.pollIntervalSeconds,
          nextPollAt,
          lastPolledAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(repositoriesTable.id, repository.id));
    } catch (error) {
      result.failed += 1;
      const pollError =
        error instanceof GitHubPollError ? error : new GitHubPollError("GitHub poll failed");
      await this.#db
        .update(repositoriesTable)
        .set({
          nextPollAt: pollError.retryAt,
          lastPolledAt: now,
          lastError: pollError.message,
          updatedAt: now,
        })
        .where(eq(repositoriesTable.id, repository.id));
    }
  }

  async #deliverCandidate(
    sourceId: string,
    integrationId: string,
    candidate: GithubActivityCandidate,
    actorByLogin: Map<string, string>,
    result: ActivityGithubPollResult,
  ): Promise<void> {
    const actor = actorByLogin.get(candidate.githubLogin.toLowerCase());
    if (!actor) {
      const [quarantined] = await this.#db
        .insert(quarantineTable)
        .values({
          integrationId,
          githubEventId: candidate.githubEventId,
          repository: String(candidate.payload.repository),
          githubLogin: candidate.githubLogin.toLowerCase(),
          eventType: candidate.eventType,
          reason: "GitHub login is not mapped to a NEAR account",
          payloadJson: JSON.stringify(candidate),
        })
        .onConflictDoNothing({
          target: [quarantineTable.integrationId, quarantineTable.githubEventId],
        })
        .returning({ id: quarantineTable.id });
      if (quarantined) result.quarantined += 1;
      return;
    }
    await this.#ingestion.submitForSource(sourceId, {
      eventType: candidate.eventType,
      actor,
      idempotencyKey: candidate.idempotencyKey,
      payload: candidate.payload,
    });
    await this.#db
      .delete(quarantineTable)
      .where(
        and(
          eq(quarantineTable.integrationId, integrationId),
          eq(quarantineTable.githubEventId, candidate.githubEventId),
        ),
      );
    result.published += 1;
  }

  async #replayQuarantine(
    sourceId: string,
    integration: IntegrationRow,
    actorByLogin: Map<string, string>,
    result: ActivityGithubPollResult,
  ): Promise<void> {
    const records = await this.#db
      .select()
      .from(quarantineTable)
      .where(eq(quarantineTable.integrationId, integration.id));
    for (const record of records) {
      const candidate = JSON.parse(record.payloadJson) as GithubActivityCandidate;
      if (actorByLogin.has(candidate.githubLogin.toLowerCase())) {
        await this.#deliverCandidate(sourceId, integration.id, candidate, actorByLogin, result);
      }
    }
  }

  async #ownedSource(organizationId: string, sourceId: string) {
    const [source] = await this.#db
      .select()
      .from(sourcesTable)
      .where(
        and(eq(sourcesTable.organizationId, organizationId), eq(sourcesTable.sourceId, sourceId)),
      )
      .limit(1);
    if (!source) throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
    return source;
  }
}

function candidateFromEvent(
  value: unknown,
  owner: string,
  repository: string,
  integration: IntegrationRow,
): GithubActivityCandidate[] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") return [];
  if (value.public !== true) return [];
  if (!isRecord(value.payload)) return [];
  const repositoryName = `${owner}/${repository}`;
  if (value.type === "PullRequestEvent" && integration.mergedPullRequestsEnabled) {
    const pullRequest = value.payload.pull_request;
    if (
      (value.payload.action !== "closed" && value.payload.action !== "merged") ||
      !isRecord(pullRequest) ||
      pullRequest.merged !== true
    ) {
      return [];
    }
    const number = integerValue(value.payload.number ?? pullRequest.number);
    const objectId = stringId(pullRequest.id);
    const githubLogin = nestedLogin(value.actor);
    if (!number || !objectId || !githubLogin)
      throw new GitHubPollError("Malformed merged pull request event");
    return [
      {
        githubEventId: value.id,
        eventType: GITHUB_MERGED_PULL_REQUEST_EVENT,
        githubLogin,
        idempotencyKey: githubIdempotencyKey(
          repositoryName,
          GITHUB_MERGED_PULL_REQUEST_EVENT,
          objectId,
        ),
        payload: {
          repository: repositoryName,
          number,
          githubObjectId: objectId,
          githubEventId: value.id,
          githubLogin,
          title: stringValue(pullRequest.title),
          url: stringValue(pullRequest.html_url),
          mergedAt: stringValue(pullRequest.merged_at),
        },
      },
    ];
  }
  if (value.type === "IssuesEvent" && integration.closedIssuesEnabled) {
    const issue = value.payload.issue;
    if (value.payload.action !== "closed" || !isRecord(issue) || isRecord(issue.pull_request))
      return [];
    const number = integerValue(issue.number);
    const objectId = stringId(issue.id);
    const githubLogin = nestedLogin(value.actor);
    if (!number || !objectId || !githubLogin)
      throw new GitHubPollError("Malformed closed issue event");
    return [
      {
        githubEventId: value.id,
        eventType: GITHUB_CLOSED_ISSUE_EVENT,
        githubLogin,
        idempotencyKey: githubIdempotencyKey(repositoryName, GITHUB_CLOSED_ISSUE_EVENT, objectId),
        payload: {
          repository: repositoryName,
          number,
          githubObjectId: objectId,
          githubEventId: value.id,
          githubLogin,
          title: stringValue(issue.title),
          url: stringValue(issue.html_url),
          closedAt: stringValue(issue.closed_at),
        },
      },
    ];
  }
  return [];
}

export function githubIdempotencyKey(
  repository: string,
  eventType: string,
  objectId: string,
): string {
  return `github:${repository.toLowerCase()}:${eventType}:${objectId}`;
}

function emptyPollResult(): ActivityGithubPollResult {
  return { repositoriesPolled: 0, notModified: 0, published: 0, quarantined: 0, failed: 0 };
}

function mergePollResult(target: ActivityGithubPollResult, source: ActivityGithubPollResult): void {
  target.repositoriesPolled += source.repositoriesPolled;
  target.notModified += source.notModified;
  target.published += source.published;
  target.quarantined += source.quarantined;
  target.failed += source.failed;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedLogin(value: unknown): string | null {
  return isRecord(value) && typeof value.login === "string" && value.login.trim()
    ? value.login.trim().toLowerCase()
    : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function stringId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
