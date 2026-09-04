import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { ORPCError, withEventMeta } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { resolveActivityRelayUrl } from "./activity/activity-config";
import { parseActivityMasterKeys } from "./activity/activity-credentials-crypto";
import {
  ActivityCursorError,
  ActivityRelay,
  ActivityRelayQueryTimeoutError,
  ActivityRelayScanLimitError,
  ActivityRelayUnavailableError,
  NostrRelayAdapter,
} from "./activity/activity-relay";
import { type ActivityFeedEvent, contract, NEAR_ACCOUNT_ID_REGEX } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createActivitySseStream } from "./lib/activity-sse";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { ActivityCredentialsLive, ActivityCredentialsTag } from "./services/activity-credentials";
import { ActivityEndorsementsService } from "./services/activity-endorsements";
import {
  ActivityFeedService,
  ActivityResumeError,
  DatabaseActivityIdentityStore,
} from "./services/activity-feed";
import { ActivityGithubService } from "./services/activity-github";
import { ActivityIngestionService } from "./services/activity-ingestion";
import {
  ActivityLeaderboardLive,
  ActivityLeaderboardTag,
  DatabaseActivityPointValueProvider,
} from "./services/activity-leaderboard";
import { DatabaseActivityLeaderboardHistory } from "./services/activity-leaderboard-history";
import {
  ActivityModerationService,
  DatabaseActivityModerationStore,
} from "./services/activity-moderation";
import { ActivitySourcesLive, ActivitySourcesTag } from "./services/activity-sources";
import { TenantsLive, TenantsTag } from "./services/tenants";

const SUBDOMAIN_SEGMENT_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const RESERVED_SUBDOMAINS = new Set([
  "root",
  "www",
  "admin",
  "api",
  "dashboard",
  "mail",
  "status",
  "help",
  "support",
  "docs",
  "blog",
  "dev",
  "test",
  "app",
  "beta",
  "demo",
  "staging",
  "internal",
  "moderation",
  "abuse",
]);

function validateSubdomain(subdomain: string): void {
  if (!SUBDOMAIN_SEGMENT_REGEX.test(subdomain)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid subdomain format",
      data: { hint: "Lowercase alphanumeric with hyphens or underscores only" },
    });
  }
}

function validateAccountId(accountId: string): void {
  if (!NEAR_ACCOUNT_ID_REGEX.test(accountId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid accountId format",
      data: { hint: "Must be a valid NEAR account ID" },
    });
  }
}

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    activityNostrBindingContract: z.string().default("contextual.near"),
    activityNostrBindingRelay: z.string().default("wss://relay.nearbuilders.org"),
    activityNostrKvApiUrl: z.string().default("https://kv.main.fastnear.com"),
    activityRelayUrl: z.string().default("wss://relay.nearbuilders.org"),
  }),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
    ACTIVITY_SIGNING_MASTER_KEYS: z.string(),
    ACTIVITY_SIGNING_ACTIVE_KEY_VERSION: z.string().default("v1"),
    ACTIVITY_REDIS_URL: z.string(),
    ACTIVITY_GITHUB_TOKEN: z.string().optional(),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const database = yield* tools.buildService(
        DatabaseTag,
        DatabaseLive(config.secrets.API_DATABASE_URL),
      );
      const databaseLayer = Layer.succeed(DatabaseTag, database);
      const tenantsService = yield* tools.buildService(
        TenantsTag,
        TenantsLive.pipe(Layer.provide(databaseLayer)),
      );
      const activitySourcesService = yield* tools.buildService(
        ActivitySourcesTag,
        ActivitySourcesLive.pipe(Layer.provide(databaseLayer)),
      );
      const masterKeys = parseActivityMasterKeys(
        config.secrets.ACTIVITY_SIGNING_MASTER_KEYS,
        config.secrets.ACTIVITY_SIGNING_ACTIVE_KEY_VERSION,
      );
      const activityCredentialsService = yield* tools.buildService(
        ActivityCredentialsTag,
        ActivityCredentialsLive(masterKeys, {
          contractId: config.variables.activityNostrBindingContract,
          relay: config.variables.activityNostrBindingRelay,
          kvApiUrl: config.variables.activityNostrKvApiUrl,
        }).pipe(Layer.provide(databaseLayer)),
      );
      const activityRelay = new ActivityRelay(
        new NostrRelayAdapter(resolveActivityRelayUrl(config.variables.activityRelayUrl)),
        {
          scanLimit: 1_000,
        },
      );
      const activityPointValues = new DatabaseActivityPointValueProvider(database);
      const activityLeaderboard = yield* tools.buildService(
        ActivityLeaderboardTag,
        ActivityLeaderboardLive({
          redisUrl: config.secrets.ACTIVITY_REDIS_URL,
          listPointValues: () => activityPointValues.listPointValues(),
        }),
      );
      const activityIngestionService = new ActivityIngestionService(
        database,
        activityCredentialsService,
        activitySourcesService,
        activityRelay,
        activityLeaderboard,
      );
      const activityGithubService = new ActivityGithubService({
        db: database,
        ingestion: activityIngestionService,
        token: config.secrets.ACTIVITY_GITHUB_TOKEN,
      });
      const activityModerationStore = new DatabaseActivityModerationStore(database);
      const activityFeedService = new ActivityFeedService(
        activityRelay,
        new DatabaseActivityIdentityStore(database),
        activityModerationStore,
      );
      const activityModerationService = new ActivityModerationService(
        activityModerationStore,
        activityFeedService,
        activityLeaderboard,
      );
      const activityEndorsementsService = new ActivityEndorsementsService(database);
      const activityLeaderboardHistory = new DatabaseActivityLeaderboardHistory(
        database,
        activityFeedService,
      );
      const leaderboardStatus = yield* Effect.promise(() => activityLeaderboard.getStatus());
      if (leaderboardStatus.state !== "ready" || config.secrets.ACTIVITY_REDIS_URL === "memory:") {
        const hiddenEvents = yield* Effect.promise(() => activityModerationStore.listHidden());
        console.info("[ActivityLeaderboard] Projection rebuild started");
        const rebuilt = yield* Effect.promise(() =>
          activityLeaderboard
            .rebuild({
              events: activityLeaderboardHistory.list(),
              hiddenEvents: hiddenEvents.map(({ event }) => event),
            })
            .catch((error) => {
              console.error("[ActivityLeaderboard] Projection rebuild failed");
              throw error;
            }),
        );
        console.info("[ActivityLeaderboard] Projection rebuild completed", rebuilt);
      }
      activityGithubService.start();

      console.log("[API] Services Initialized");

      return {
        database,
        tenants: tenantsService,
        activitySources: activitySourcesService,
        activityCredentials: activityCredentialsService,
        activityIngestion: activityIngestionService,
        activityGithub: activityGithubService,
        activityFeed: activityFeedService,
        activityEndorsements: activityEndorsementsService,
        activityModeration: activityModerationService,
        activityLeaderboard,
        activityRelay,
      };
    }),

  shutdown: (services) =>
    Effect.sync(() => {
      services.activityGithub.stop();
      services.activityRelay.close();
    }),

  createRouter: (services, builder) => {
    const { requireAdmin, requireAuth, requireOrganization, requireOrgRole } =
      createAuthMiddleware(builder);
    const requireNearAuthentication = builder.middleware(async ({ context, next }) => {
      if (!context.near?.hasNearAccount || !context.near.primaryAccountId) {
        throw new ORPCError("FORBIDDEN", {
          message: "NEAR authentication required",
          data: { hint: "Connect a NEAR account before registering an Activity Source" },
        });
      }
      return next({ context: { near: context.near } });
    });
    const authorizedTenant = async (
      input: { tenantId: string },
      context: { organization: { activeOrganizationId: string } },
    ) => {
      const activeOrgId = context.organization.activeOrganizationId;
      const tenant = await services.tenants.resolveTenantById(input.tenantId);
      if (!tenant) {
        throw new ORPCError("NOT_FOUND", {
          message: "Tenant not found",
          data: { resource: "tenant", resourceId: input.tenantId },
        });
      }
      if (tenant.orgId !== activeOrgId) {
        throw new ORPCError("FORBIDDEN", {
          message: "You are not a member of this tenant's organization",
        });
      }
      return tenant;
    };
    const requireVisibleActivityEvent = async (eventId: string) => {
      try {
        const result = await services.activityFeed.list({ eventId, limit: 1 });
        if (!result.data[0]) {
          throw new ORPCError("NOT_FOUND", { message: "Activity event not found" });
        }
      } catch (error) {
        if (
          error instanceof ActivityRelayQueryTimeoutError ||
          error instanceof ActivityRelayScanLimitError ||
          error instanceof ActivityRelayUnavailableError
        ) {
          throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
        }
        throw error;
      }
    };

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      authHealth: builder.authHealth.use(requireAuth).handler(async () => ({
        status: "ok",
        emailConfigured: !!process.env.EMAIL_PROVIDER,
        smsConfigured: !!process.env.SMS_PROVIDER,
      })),

      listTenants: builder.listTenants
        .use(requireAuth)
        .use(requireOrganization)
        .handler(async ({ context }) =>
          services.tenants.listTenantsByOrgIds([context.organization.activeOrganizationId]),
        ),

      createTenant: builder.createTenant
        .use(requireAuth)
        .use(requireOrganization)
        .handler(async ({ input, context }) => {
          validateSubdomain(input.subdomain);
          validateAccountId(input.accountId);
          if (!input.accountId.startsWith(`${input.subdomain}.`)) {
            throw new ORPCError("BAD_REQUEST", {
              message: "accountId must start with subdomain",
              data: { subdomain: input.subdomain, accountId: input.accountId },
            });
          }
          return await services.tenants.createTenant({
            subdomain: input.subdomain,
            name: input.name,
            accountId: input.accountId,
            orgId: context.organization.activeOrganizationId,
            status: input.status,
          });
        }),

      updateTenant: builder.updateTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          const tenant = await authorizedTenant(input, context);
          if (input.subdomain !== undefined) validateSubdomain(input.subdomain);
          if (input.accountId !== undefined) validateAccountId(input.accountId);
          return await services.tenants.updateTenant(tenant.id, {
            name: input.name,
            subdomain: input.subdomain,
            accountId: input.accountId,
            status: input.status,
          });
        }),

      deleteTenant: builder.deleteTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.softDeleteTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      suspendTenant: builder.suspendTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.suspendTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      reactivateTenant: builder.reactivateTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.reactivateTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      resolveTenant: builder.resolveTenant.handler(async ({ input }) => {
        const tenant = await services.tenants.resolveTenantByAccountId(input.accountId);
        return tenant ?? null;
      }),

      resolveTenantByOrgId: builder.resolveTenantByOrgId.handler(async ({ input, errors }) => {
        const tenant = await services.tenants.resolveTenantByOrgId(input.orgId);
        if (!tenant) {
          throw errors.NOT_FOUND({
            message: "Tenant not found",
            data: { resource: "tenant", resourceId: input.orgId },
          });
        }
        return tenant;
      }),

      tenantPreflight: builder.tenantPreflight.use(requireAuth).handler(async ({ input }) => {
        const subdomainValid = SUBDOMAIN_SEGMENT_REGEX.test(input.subdomain);
        const accountId = `${input.subdomain}.${input.parentAccount}`;
        const accountFormat = NEAR_ACCOUNT_ID_REGEX.test(accountId)
          ? ("valid" as const)
          : ("invalid" as const);

        const reserved = RESERVED_SUBDOMAINS.has(input.subdomain);
        const existingSubdomain = subdomainValid
          ? await services.tenants.resolveTenantBySubdomain(input.subdomain)
          : null;
        const existingAccount = subdomainValid
          ? await services.tenants.resolveTenantByAccountId(accountId)
          : null;
        const accountAvailable = accountFormat === "valid" && !existingAccount;

        return {
          subdomain: { available: !reserved && !existingSubdomain, reserved },
          accountId: { format: accountFormat, available: accountAvailable },
        };
      }),

      createActivitySource: builder.createActivitySource
        .use(requireNearAuthentication)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          validateAccountId(input.nearAccountId);
          return await services.activitySources.createSource({
            ...input,
            organizationId: context.organization.activeOrganizationId,
          });
        }),

      listActivitySources: builder.listActivitySources
        .use(requireOrgRole("owner", "admin", "member"))
        .handler(async ({ context }) =>
          services.activitySources.listSourcesByOrganization(
            context.organization.activeOrganizationId,
          ),
        ),

      updateActivitySource: builder.updateActivitySource
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          if (
            input.displayName === undefined &&
            input.nearAccountId === undefined &&
            input.eventTypes === undefined
          ) {
            throw new ORPCError("BAD_REQUEST", {
              message: "At least one source field must be updated",
            });
          }
          if (input.nearAccountId !== undefined) validateAccountId(input.nearAccountId);
          return await services.activitySources.updateSource(
            context.organization.activeOrganizationId,
            input.sourceId,
            {
              displayName: input.displayName,
              nearAccountId: input.nearAccountId,
              eventTypes: input.eventTypes,
            },
          );
        }),

      listActivitySourcesForReview: builder.listActivitySourcesForReview
        .use(requireAdmin)
        .handler(async ({ input }) =>
          services.activitySources.listSourcesForReview(input.approvalStatus),
        ),

      reviewActivitySource: builder.reviewActivitySource
        .use(requireAdmin)
        .handler(async ({ input, context }) =>
          services.activitySources.reviewSource({
            ...input,
            administratorId: context.userId,
          }),
        ),

      updateActivitySourceTrust: builder.updateActivitySourceTrust
        .use(requireAdmin)
        .handler(async ({ input, context }) =>
          services.activitySources.updateSourceTrust({
            ...input,
            administratorId: context.userId,
          }),
        ),

      createActivitySigningIdentity: builder.createActivitySigningIdentity
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.createSigningIdentity(
            context.organization.activeOrganizationId,
            input.sourceId,
            context.userId,
          ),
        ),

      getActivitySigningIdentity: builder.getActivitySigningIdentity
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.getSigningIdentity(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      listActivitySigningIdentities: builder.listActivitySigningIdentities
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.listSigningIdentities(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      rotateActivitySigningIdentity: builder.rotateActivitySigningIdentity
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.rotateSigningIdentity(
            context.organization.activeOrganizationId,
            input.sourceId,
            context.userId,
            input.reason ?? "Signing Identity rotated by Source Owner",
          ),
        ),

      prepareActivitySigningIdentityBinding: builder.prepareActivitySigningIdentityBinding
        .use(requireNearAuthentication)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          const nearAccountId = context.near.primaryAccountId;
          if (!nearAccountId) {
            throw new ORPCError("FORBIDDEN", { message: "NEAR authentication required" });
          }
          return services.activityCredentials.prepareSigningIdentityBinding(
            context.organization.activeOrganizationId,
            input.sourceId,
            nearAccountId,
          );
        }),

      confirmActivitySigningIdentityBinding: builder.confirmActivitySigningIdentityBinding
        .use(requireNearAuthentication)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          const nearAccountId = context.near.primaryAccountId;
          if (!nearAccountId) {
            throw new ORPCError("FORBIDDEN", { message: "NEAR authentication required" });
          }
          return services.activityCredentials.confirmSigningIdentityBinding(
            context.organization.activeOrganizationId,
            input.sourceId,
            nearAccountId,
          );
        }),

      createActivitySourceApiKey: builder.createActivitySourceApiKey
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.createApiKey(
            context.organization.activeOrganizationId,
            input.sourceId,
            input.name,
          ),
        ),

      listActivitySourceApiKeys: builder.listActivitySourceApiKeys
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.listApiKeys(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      revokeActivitySourceApiKey: builder.revokeActivitySourceApiKey
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityCredentials.revokeApiKey(
            context.organization.activeOrganizationId,
            input.sourceId,
            input.apiKeyId,
          ),
        ),

      getActivityGithubIntegration: builder.getActivityGithubIntegration
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityGithub.getConfiguration(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      configureActivityGithubIntegration: builder.configureActivityGithubIntegration
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityGithub.configure(
            context.organization.activeOrganizationId,
            input.sourceId,
            input,
          ),
        ),

      pollActivityGithubIntegration: builder.pollActivityGithubIntegration
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityGithub.pollSource(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      listActivityGithubQuarantine: builder.listActivityGithubQuarantine
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) =>
          services.activityGithub.listQuarantine(
            context.organization.activeOrganizationId,
            input.sourceId,
          ),
        ),

      submitActivityEvent: builder.submitActivityEvent.handler(async ({ input, context }) => {
        const authorization = context.reqHeaders?.get("authorization");
        const apiKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!apiKey) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Source API Key required",
          });
        }
        return services.activityIngestion.submit(apiKey, input);
      }),

      listActivityEvents: builder.listActivityEvents.handler(async ({ input }) => {
        try {
          return await services.activityFeed.list({
            source: input.source,
            eventType: input.type,
            actor: input.actor,
            limit: input.limit,
            cursor: input.cursor,
          });
        } catch (error) {
          if (error instanceof ActivityCursorError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          if (
            error instanceof ActivityRelayQueryTimeoutError ||
            error instanceof ActivityRelayScanLimitError ||
            error instanceof ActivityRelayUnavailableError
          ) {
            throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
          }
          throw error;
        }
      }),

      endorseActivityEvent: builder.endorseActivityEvent
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          await requireVisibleActivityEvent(input.eventId);
          return services.activityEndorsements.endorse(input.eventId, context.userId);
        }),

      unendorseActivityEvent: builder.unendorseActivityEvent
        .use(requireAuth)
        .handler(async ({ input, context }) =>
          services.activityEndorsements.unendorse(input.eventId, context.userId),
        ),

      getActivityEventEndorsements: builder.getActivityEventEndorsements.handler(
        async ({ input, context }) =>
          services.activityEndorsements.getStates(input.eventIds, context.userId ?? undefined),
      ),

      streamActivityEventEndorsements: builder.streamActivityEventEndorsements.handler(
        async function* ({ context, signal, lastEventId }) {
          const iterator = services.activityEndorsements.publisher.subscribe("endorsement", {
            signal,
            lastEventId,
          });
          for await (const update of iterator) {
            yield {
              operation: update.operation,
              eventId: update.eventId,
              timestamp: update.timestamp,
              totalCount: update.totalCount,
              changedByCurrentUser: context.userId === update.userId,
            };
          }
        },
      ),

      streamActivityEvents: builder.streamActivityEvents.handler(async function* ({
        input,
        signal,
        lastEventId,
      }) {
        try {
          for await (const event of services.activityFeed.stream(
            {
              source: input.source,
              eventType: input.type,
              actor: input.actor,
            },
            { lastEventId, signal },
          )) {
            yield withEventMeta(event, { id: event.id, retry: 1_000 });
          }
        } catch (error) {
          if (error instanceof ActivityResumeError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          if (
            error instanceof ActivityRelayQueryTimeoutError ||
            error instanceof ActivityRelayScanLimitError ||
            error instanceof ActivityRelayUnavailableError
          ) {
            throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
          }
          throw error;
        }
      }),

      streamActivityEventsSse: builder.streamActivityEventsSse.handler(
        ({ input, context, signal }) => {
          const lastEventId = context.reqHeaders?.get("last-event-id") ?? undefined;
          let markReady: () => void = () => undefined;
          const ready = new Promise<void>((resolve) => {
            markReady = resolve;
          });
          const events = services.activityFeed.stream(
            {
              source: input.source,
              eventType: input.type,
              actor: input.actor,
            },
            { lastEventId, signal, onReady: markReady },
          ) as AsyncGenerator<ActivityFeedEvent>;

          return {
            status: 200 as const,
            headers: {
              "cache-control": "no-cache",
              "content-type": "text/event-stream; charset=utf-8",
            },
            body: createActivitySseStream(events, ready),
          };
        },
      ),

      hideActivityEvent: builder.hideActivityEvent
        .use(requireAdmin)
        .handler(async ({ input, context }) => {
          try {
            return await services.activityModeration.hide({
              ...input,
              administratorId: context.userId,
            });
          } catch (error) {
            if (
              error instanceof ActivityRelayQueryTimeoutError ||
              error instanceof ActivityRelayScanLimitError ||
              error instanceof ActivityRelayUnavailableError
            ) {
              throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
            }
            throw error;
          }
        }),

      listHiddenActivityEvents: builder.listHiddenActivityEvents
        .use(requireAdmin)
        .handler(async () => services.activityModeration.listHidden()),

      getActivityLeaderboard: builder.getActivityLeaderboard.handler(async ({ input }) => {
        try {
          return await services.activityLeaderboard.getLeaderboard(input);
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: "Activity leaderboard projection is unavailable",
          });
        }
      }),

      getActivityLeaderboardStatus: builder.getActivityLeaderboardStatus.handler(async () => {
        try {
          return await services.activityLeaderboard.getStatus();
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: "Activity leaderboard projection status is unavailable",
          });
        }
      }),

      createThing: builder.createThing.use(requireAuth).handler(async ({ input }) => {
        throw new ORPCError("BAD_REQUEST", {
          message: `The template plugin is not included; cannot create ${input.thingId}`,
        });
      }),

      getThing: builder.getThing.handler(async ({ input }) => {
        throw new ORPCError("BAD_REQUEST", {
          message: `The template plugin is not included; cannot read ${input.thingId}`,
        });
      }),

      listThings: builder.listThings.handler(async () => {
        throw new ORPCError("BAD_REQUEST", {
          message: "The template plugin is not included in this deployment",
        });
      }),

      deleteThing: builder.deleteThing.use(requireAuth).handler(async ({ input }) => {
        throw new ORPCError("BAD_REQUEST", {
          message: `The template plugin is not included; cannot delete ${input.thingId}`,
        });
      }),

      testError: builder.testError.handler(async ({ input }) => {
        switch (input.kind) {
          case "unauthorized":
            throw new ORPCError("UNAUTHORIZED", { message: "test unauthorized error" });
          case "forbidden":
            throw new ORPCError("FORBIDDEN", { message: "test forbidden error" });
          case "not_found":
            throw new ORPCError("NOT_FOUND", { message: "test not found error" });
          case "conflict":
            throw new ORPCError("CONFLICT", { message: "test conflict error" });
          case "bad_request":
            throw new ORPCError("BAD_REQUEST", { message: "test bad request error" });
          default:
            throw new Error("test internal server error");
        }
      }),
    };
  },
});
