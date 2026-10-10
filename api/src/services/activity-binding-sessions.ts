import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  activityBindingSessions as sessionsTable,
  activitySources as sourcesTable,
} from "../db/schema";
import type { ActivityCredentialsService } from "./activity-credentials";
import type { NearbuildersProjectDraft } from "./nearbuilders-projects";

export const BINDING_SESSION_TTL_MS = 30 * 60 * 1_000;
export const BINDING_SESSION_CLAIM_TTL_MS = 24 * 60 * 60 * 1_000;
export const BINDING_SESSION_RATE_WINDOW_MS = 10 * 60 * 1_000;
export const BINDING_SESSION_REQUESTER_LIMIT = 10;
export const BINDING_SESSION_GLOBAL_LIMIT = 300;

const MATCH_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface ActivityBindingDraft {
  project?: { reference?: string; id?: string; slug?: string; title?: string; url?: string };
  sourceId?: string;
  displayName?: string;
  nearAccountId?: string;
  eventTypes?: Array<{
    name: string;
    description: string;
    enabled: boolean;
    pointValue: number;
  }>;
}

export type ActivityBindingSessionStatus = "waiting" | "ready" | "claimed" | "expired";

export interface ActivityBindingSessionView {
  matchCode: string;
  status: ActivityBindingSessionStatus;
  draft: ActivityBindingDraft;
  sourceId: string | null;
  expiresAt: string;
}

export type ActivityBindingClaim =
  | { status: "waiting" | "expired" }
  | { status: "claimed"; sourceId: string }
  | {
      status: "ready";
      sourceId: string;
      secret: string;
      apiKeyId: string;
    };

export interface ActivityBindingSessionsOptions {
  now?: () => Date;
  requesterLimit?: number;
  globalLimit?: number;
  resolveProject?: (reference: string) => Promise<NearbuildersProjectDraft>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createMatchCode(): string {
  const characters = Array.from(
    { length: 6 },
    () => MATCH_CODE_ALPHABET[randomInt(MATCH_CODE_ALPHABET.length)],
  );
  return `${characters.slice(0, 3).join("")}-${characters.slice(3).join("")}`;
}

function sessionNotFound(): ORPCError<"NOT_FOUND", unknown> {
  return new ORPCError("NOT_FOUND", { message: "Binding session not found" });
}

export class ActivityBindingSessionsService {
  readonly #db: Database;
  readonly #credentials: ActivityCredentialsService;
  readonly #now: () => Date;
  readonly #resolveProject: ActivityBindingSessionsOptions["resolveProject"];
  readonly #requesterLimit: number;
  readonly #globalLimit: number;

  constructor(
    db: Database,
    credentials: ActivityCredentialsService,
    options: ActivityBindingSessionsOptions = {},
  ) {
    this.#db = db;
    this.#credentials = credentials;
    this.#now = options.now ?? (() => new Date());
    this.#resolveProject = options.resolveProject;
    this.#requesterLimit = options.requesterLimit ?? BINDING_SESSION_REQUESTER_LIMIT;
    this.#globalLimit = options.globalLimit ?? BINDING_SESSION_GLOBAL_LIMIT;
  }

  async #enforceRateLimit(requesterKeyHash: string | null) {
    const since = new Date(this.#now().getTime() - BINDING_SESSION_RATE_WINDOW_MS);
    const [requester] = requesterKeyHash
      ? await this.#db
          .select({ total: count() })
          .from(sessionsTable)
          .where(
            and(
              eq(sessionsTable.requesterKeyHash, requesterKeyHash),
              gte(sessionsTable.createdAt, since),
            ),
          )
      : [];
    if ((requester?.total ?? 0) >= this.#requesterLimit) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Too many binding sessions started. Try again in a few minutes.",
      });
    }
    const [overall] = await this.#db
      .select({ total: count() })
      .from(sessionsTable)
      .where(gte(sessionsTable.createdAt, since));
    if ((overall?.total ?? 0) >= this.#globalLimit) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Activity is handling too many binding sessions. Try again in a few minutes.",
      });
    }
  }

  async prefill(draft: ActivityBindingDraft): Promise<ActivityBindingDraft> {
    const reference = draft.project?.reference ?? draft.project?.slug ?? draft.project?.id;
    if (!reference || !this.#resolveProject) return draft;
    const resolved = await this.#resolveProject(reference);
    return {
      ...draft,
      project: resolved.project,
      sourceId: draft.sourceId ?? resolved.sourceId,
      displayName: draft.displayName ?? resolved.displayName,
      nearAccountId: draft.nearAccountId ?? resolved.nearAccountId,
    };
  }

  async create(
    input: ActivityBindingDraft,
    origin: string,
    requesterKey: string | null,
  ): Promise<{
    sessionId: string;
    url: string;
    pollToken: string;
    matchCode: string;
    expiresAt: string;
    draft: ActivityBindingDraft;
  }> {
    const requesterKeyHash = requesterKey ? hashToken(requesterKey) : null;
    await this.#enforceRateLimit(requesterKeyHash);
    const draft = await this.prefill(input);
    const sessionToken = `abs_${randomBytes(32).toString("base64url")}`;
    const pollToken = `abp_${randomBytes(32).toString("base64url")}`;
    const matchCode = createMatchCode();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + BINDING_SESSION_TTL_MS);
    const [created] = await this.#db
      .insert(sessionsTable)
      .values({
        sessionTokenHash: hashToken(sessionToken),
        pollTokenHash: hashToken(pollToken),
        matchCode,
        draftJson: JSON.stringify(draft),
        requesterKeyHash,
        expiresAt,
        createdAt: now,
        claimExpiresAt: new Date(now.getTime() + BINDING_SESSION_CLAIM_TTL_MS),
      })
      .returning({ id: sessionsTable.id });
    if (!created) throw new Error("Binding session was not created");
    const url = new URL("/binding", origin);
    url.searchParams.set("sessionToken", sessionToken);
    return {
      sessionId: created.id,
      url: url.toString(),
      pollToken,
      matchCode,
      expiresAt: expiresAt.toISOString(),
      draft,
    };
  }

  async lookup(sessionToken: string): Promise<ActivityBindingSessionView> {
    const [result] = await this.#db
      .select({ session: sessionsTable, sourceId: sourcesTable.sourceId })
      .from(sessionsTable)
      .leftJoin(sourcesTable, eq(sourcesTable.id, sessionsTable.sourceRecordId))
      .where(eq(sessionsTable.sessionTokenHash, hashToken(sessionToken)))
      .limit(1);
    if (!result) throw sessionNotFound();
    return {
      matchCode: result.session.matchCode,
      status: this.#statusOf(result.session),
      draft: JSON.parse(result.session.draftJson) as ActivityBindingDraft,
      sourceId: result.sourceId ?? null,
      expiresAt: result.session.expiresAt.toISOString(),
    };
  }

  async complete(input: {
    sessionToken: string;
    organizationId: string;
    sourceId: string;
    actorId: string;
  }): Promise<ActivityBindingSessionView> {
    const [session] = await this.#db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.sessionTokenHash, hashToken(input.sessionToken)))
      .limit(1);
    if (!session) throw sessionNotFound();
    const status = this.#statusOf(session);
    if (status === "expired") {
      throw new ORPCError("BAD_REQUEST", { message: "Binding session has expired" });
    }
    if (status !== "waiting") {
      throw new ORPCError("CONFLICT", { message: "Binding session is already complete" });
    }
    const [source] = await this.#db
      .select({ id: sourcesTable.id, nearbuildersProjectId: sourcesTable.nearbuildersProjectId })
      .from(sourcesTable)
      .where(
        and(
          eq(sourcesTable.sourceId, input.sourceId),
          eq(sourcesTable.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!source) {
      throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
    }
    const draftProjectId = (JSON.parse(session.draftJson) as ActivityBindingDraft).project?.id;
    if (draftProjectId && source.nearbuildersProjectId !== draftProjectId) {
      throw new ORPCError("FORBIDDEN", {
        message: "This Activity Source was not registered for the project this session is for",
      });
    }
    const identity = await this.#credentials.getSigningIdentity(
      input.organizationId,
      input.sourceId,
    );
    if (identity?.bindingStatus !== "bound") {
      throw new ORPCError("FORBIDDEN", {
        message: "Link the Activity Source on-chain before completing the binding session",
      });
    }
    const [updated] = await this.#db
      .update(sessionsTable)
      .set({ sourceRecordId: source.id, completedBy: input.actorId, completedAt: this.#now() })
      .where(and(eq(sessionsTable.id, session.id), isNull(sessionsTable.completedAt)))
      .returning();
    if (!updated) {
      throw new ORPCError("CONFLICT", { message: "Binding session is already complete" });
    }
    return {
      matchCode: updated.matchCode,
      status: this.#statusOf(updated),
      draft: JSON.parse(updated.draftJson) as ActivityBindingDraft,
      sourceId: input.sourceId,
      expiresAt: updated.expiresAt.toISOString(),
    };
  }

  async claim(sessionId: string, pollToken: string): Promise<ActivityBindingClaim> {
    const [result] = await this.#db
      .select({ session: sessionsTable, source: sourcesTable })
      .from(sessionsTable)
      .leftJoin(sourcesTable, eq(sourcesTable.id, sessionsTable.sourceRecordId))
      .where(
        and(eq(sessionsTable.id, sessionId), eq(sessionsTable.pollTokenHash, hashToken(pollToken))),
      )
      .limit(1);
    if (!result) throw sessionNotFound();
    const status = this.#statusOf(result.session);
    if (status === "waiting" || status === "expired") return { status };
    const source = result.source;
    if (!source) return { status: "expired" };
    if (status === "claimed") return { status: "claimed", sourceId: source.sourceId };

    const claimedAt = this.#now();
    const [reserved] = await this.#db
      .update(sessionsTable)
      .set({ keyClaimedAt: claimedAt })
      .where(and(eq(sessionsTable.id, result.session.id), isNull(sessionsTable.keyClaimedAt)))
      .returning({ id: sessionsTable.id });
    if (!reserved) return { status: "claimed", sourceId: source.sourceId };
    try {
      const { secret, apiKey } = await this.#credentials.createApiKey(
        source.organizationId,
        source.sourceId,
        "Agent binding key",
      );
      return { status: "ready", sourceId: source.sourceId, secret, apiKeyId: apiKey.id };
    } catch (error) {
      await this.#db
        .update(sessionsTable)
        .set({ keyClaimedAt: null })
        .where(eq(sessionsTable.id, result.session.id));
      throw error;
    }
  }

  #statusOf(session: typeof sessionsTable.$inferSelect): ActivityBindingSessionStatus {
    const now = this.#now().getTime();
    if (session.keyClaimedAt) return "claimed";
    if (session.completedAt) {
      return now > session.claimExpiresAt.getTime() ? "expired" : "ready";
    }
    return now > session.expiresAt.getTime() ? "expired" : "waiting";
  }
}
