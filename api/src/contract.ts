import {
  BAD_REQUEST,
  FORBIDDEN,
  NOT_FOUND,
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
} from "every-plugin/errors";
import { eventIterator, oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const ErrorTestKindSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "bad_request",
  "internal",
]);

export const NEAR_ACCOUNT_ID_REGEX =
  /^(?=.{2,64}$)([a-z0-9]+(?:[-_][a-z0-9]+)*)(\.([a-z0-9]+(?:[-_][a-z0-9]+)*))*$/;
export const ACTIVITY_SOURCE_ID_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const ACTIVITY_EVENT_TYPE_NAME_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const ActivityEventTypeNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(ACTIVITY_EVENT_TYPE_NAME_REGEX);

const NearAccountIdSchema = z.string().min(2).max(64).regex(NEAR_ACCOUNT_ID_REGEX);

export const TenantStatusSchema = z.enum(["active", "pending", "suspended", "pending_deletion"]);

export const TenantSchema = z.object({
  id: z.string(),
  subdomain: z.string(),
  accountId: z.string(),
  orgId: z.string(),
  name: z.string(),
  status: TenantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const ActivitySourceApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const ActivityEventTypeSchema = z.object({
  name: ActivityEventTypeNameSchema,
  description: z.string().min(1).max(500),
  enabled: z.boolean(),
  pointValue: z.number().int().min(0).max(1_000_000),
});

export const ActivitySourceReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string(),
  administratorId: z.string(),
  reviewedAt: z.string(),
});

export const ActivitySourceSchema = z.object({
  sourceId: z.string(),
  displayName: z.string(),
  nearAccountId: z.string(),
  organizationId: z.string(),
  approvalStatus: ActivitySourceApprovalStatusSchema,
  canIngest: z.boolean(),
  eventTypes: z.array(ActivityEventTypeSchema),
  reviewHistory: z.array(ActivitySourceReviewSchema),
  reviewedBy: z.string().nullable(),
  reviewReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ActivitySigningIdentitySchema = z.object({
  publicKey: z.string().regex(/^[a-f0-9]{64}$/),
  bindingStatus: z.enum(["pending", "bound"]),
  boundNearAccountId: z.string().nullable(),
  boundAt: z.string().nullable(),
  keyVersion: z.string(),
  createdAt: z.string(),
  retiredAt: z.string().nullable(),
});

export const ActivityBindingWriteSchema = z.object({
  contractId: z.string(),
  methodName: z.literal("__fastdata_kv"),
  key: z.string(),
  value: z.string(),
  args: z.record(z.string(), z.string()),
  gas: z.string(),
  attachedDeposit: z.string(),
});

export const ActivitySourceApiKeySchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  name: z.string(),
  prefix: z.string(),
  permissions: z.tuple([z.literal("event:write")]),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const ActivityEventSubmissionSchema = z.object({
  eventType: ActivityEventTypeNameSchema,
  actor: NearAccountIdSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  payload: z.json(),
});

export const ActivityFeedEventSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.string(),
  type: ActivityEventTypeNameSchema,
  actor: NearAccountIdSchema,
  idempotencyKey: z.string(),
  timestamp: z.iso.datetime(),
  payload: z.json(),
});

export type ActivityFeedEvent = z.infer<typeof ActivityFeedEventSchema>;

const ActivitySseResponseSchema = z.object({
  status: z.literal(200),
  headers: z.record(z.string(), z.string()),
  body: z.custom<ReadableStream<Uint8Array>>(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      "getReader" in value &&
      typeof value.getReader === "function",
  ),
});

export const ActivityFeedSchema = z.object({
  data: z.array(ActivityFeedEventSchema),
  meta: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    skippedInvalid: z.number().int().min(0),
  }),
});

const ActivityEventTypesInputSchema = z
  .array(ActivityEventTypeSchema)
  .min(1)
  .max(50)
  .refine((eventTypes) => new Set(eventTypes.map(({ name }) => name)).size === eventTypes.length, {
    message: "Event type names must be unique",
  });

const ThingSchema = z.object({
  thingId: z.string().describe("Unique identifier for the thing"),
  type: z.string().describe("Plugin-derived thing type"),
  payload: z.unknown().describe("Plugin-owned thing payload"),
  createdAt: z.string().datetime().describe("ISO 8601 timestamp when the thing was created"),
  updatedAt: z.string().datetime().describe("ISO 8601 timestamp when the thing was last updated"),
});

const CreatedThingSchema = ThingSchema.extend({
  action: z.string().describe("Action emitted for the creation"),
});

const ListThingsSchema = z.object({
  data: z.array(ThingSchema).describe("List of things matching the query"),
  meta: z.object({
    total: z.number().describe("Total number of matching things"),
    hasMore: z.boolean().describe("Whether another page of results exists"),
    nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null if done"),
  }),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  authHealth: oc
    .route({ method: "GET", path: "/auth/health" })
    .output(
      z.object({
        status: z.string(),
        emailConfigured: z.boolean(),
        smsConfigured: z.boolean(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  listTenants: oc
    .route({ method: "GET", path: "/tenants" })
    .output(z.array(TenantSchema))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  createTenant: oc
    .route({ method: "POST", path: "/tenants" })
    .input(
      z.object({
        subdomain: z.string(),
        name: z.string(),
        accountId: z.string(),
        status: z.enum(["active", "pending"]).optional(),
      }),
    )
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

  updateTenant: oc
    .route({ method: "PATCH", path: "/tenants/{tenantId}" })
    .input(
      z.object({
        tenantId: z.string(),
        name: z.string().optional(),
        subdomain: z.string().optional(),
        accountId: z.string().optional(),
        status: TenantStatusSchema.optional(),
      }),
    )
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  deleteTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/delete" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  suspendTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/suspend" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  reactivateTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/reactivate" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  resolveTenant: oc
    .route({ method: "GET", path: "/tenants/account/{accountId}" })
    .input(z.object({ accountId: z.string() }))
    .output(TenantSchema.nullable()),

  resolveTenantByOrgId: oc
    .route({ method: "GET", path: "/tenants/org/{orgId}" })
    .input(z.object({ orgId: z.string() }))
    .output(TenantSchema)
    .errors({ NOT_FOUND }),

  tenantPreflight: oc
    .route({ method: "POST", path: "/tenants/preflight" })
    .input(
      z.object({
        subdomain: z.string(),
        parentAccount: z.string(),
      }),
    )
    .output(
      z.object({
        subdomain: z.object({
          available: z.boolean(),
          reserved: z.boolean(),
        }),
        accountId: z.object({
          format: z.enum(["valid", "invalid"]),
          available: z.boolean(),
        }),
      }),
    )
    .errors({ UNAUTHORIZED, BAD_REQUEST }),

  createActivitySource: oc
    .route({ method: "POST", path: "/activity/sources" })
    .input(
      z.object({
        sourceId: z.string().min(2).max(100).regex(ACTIVITY_SOURCE_ID_REGEX),
        displayName: z.string().trim().min(1).max(120),
        nearAccountId: z.string().min(2).max(64),
        eventTypes: ActivityEventTypesInputSchema,
      }),
    )
    .output(ActivitySourceSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONFLICT: { status: 409 } }),

  listActivitySources: oc
    .route({ method: "GET", path: "/activity/sources" })
    .output(z.array(ActivitySourceSchema))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  updateActivitySource: oc
    .route({ method: "PATCH", path: "/activity/sources/{sourceId}" })
    .input(
      z.object({
        sourceId: z.string(),
        displayName: z.string().trim().min(1).max(120).optional(),
        nearAccountId: z.string().min(2).max(64).optional(),
        eventTypes: ActivityEventTypesInputSchema.optional(),
      }),
    )
    .output(ActivitySourceSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST, CONFLICT: { status: 409 } }),

  listActivitySourcesForReview: oc
    .route({ method: "GET", path: "/activity/source-reviews" })
    .input(z.object({ approvalStatus: ActivitySourceApprovalStatusSchema.optional() }))
    .output(z.array(ActivitySourceSchema))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  reviewActivitySource: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/review" })
    .input(
      z.object({
        sourceId: z.string(),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().trim().min(1).max(1_000),
      }),
    )
    .output(ActivitySourceSchema)
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      NOT_FOUND,
      CONFLICT: { status: 409 },
    }),

  createActivitySigningIdentity: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/signing-identity" })
    .input(z.object({ sourceId: z.string() }))
    .output(ActivitySigningIdentitySchema)
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      NOT_FOUND,
      CONFLICT: { status: 409 },
    }),

  getActivitySigningIdentity: oc
    .route({ method: "GET", path: "/activity/sources/{sourceId}/signing-identity" })
    .input(z.object({ sourceId: z.string() }))
    .output(ActivitySigningIdentitySchema.nullable())
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  listActivitySigningIdentities: oc
    .route({ method: "GET", path: "/activity/sources/{sourceId}/signing-identities" })
    .input(z.object({ sourceId: z.string() }))
    .output(z.array(ActivitySigningIdentitySchema))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  rotateActivitySigningIdentity: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/signing-identity/rotate" })
    .input(z.object({ sourceId: z.string() }))
    .output(ActivitySigningIdentitySchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  prepareActivitySigningIdentityBinding: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/signing-identity/binding" })
    .input(z.object({ sourceId: z.string() }))
    .output(ActivityBindingWriteSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  confirmActivitySigningIdentityBinding: oc
    .route({
      method: "POST",
      path: "/activity/sources/{sourceId}/signing-identity/binding/confirm",
    })
    .input(z.object({ sourceId: z.string() }))
    .output(ActivitySigningIdentitySchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  createActivitySourceApiKey: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/api-keys" })
    .input(z.object({ sourceId: z.string(), name: z.string().trim().min(1).max(120) }))
    .output(z.object({ secret: z.string(), apiKey: ActivitySourceApiKeySchema }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  listActivitySourceApiKeys: oc
    .route({ method: "GET", path: "/activity/sources/{sourceId}/api-keys" })
    .input(z.object({ sourceId: z.string() }))
    .output(z.array(ActivitySourceApiKeySchema))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  revokeActivitySourceApiKey: oc
    .route({ method: "POST", path: "/activity/sources/{sourceId}/api-keys/{apiKeyId}/revoke" })
    .input(z.object({ sourceId: z.string(), apiKeyId: z.string() }))
    .output(ActivitySourceApiKeySchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  submitActivityEvent: oc
    .route({
      method: "POST",
      path: "/v1/events",
      summary: "Submit an Activity event",
      description:
        "Authenticates a Source API Key and publishes one exactly-once, source-signed Nostr event.",
      tags: ["Activity"],
    })
    .input(ActivityEventSubmissionSchema)
    .output(z.object({ eventId: z.string().regex(/^[a-f0-9]{64}$/) }))
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      BAD_REQUEST,
      SERVICE_UNAVAILABLE,
      CONFLICT: { status: 409 },
    }),

  listActivityEvents: oc
    .route({
      method: "GET",
      path: "/v1/events",
      summary: "Browse Activity events",
      description: "Returns trusted Activity events in deterministic reverse-chronological order.",
      tags: ["Activity"],
    })
    .input(
      z.object({
        source: z.string().min(2).max(100).regex(ACTIVITY_SOURCE_ID_REGEX).optional(),
        type: ActivityEventTypeNameSchema.optional(),
        actor: NearAccountIdSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .output(ActivityFeedSchema)
    .errors({ BAD_REQUEST, SERVICE_UNAVAILABLE }),

  streamActivityEvents: oc
    .route({
      method: "POST",
      path: "/internal/activity/events/stream",
      summary: "Stream Activity events over typed RPC",
      description: "Internal typed stream used by the Activity feed UI.",
      tags: ["Activity"],
    })
    .input(
      z.object({
        source: z.string().min(2).max(100).regex(ACTIVITY_SOURCE_ID_REGEX).optional(),
        type: ActivityEventTypeNameSchema.optional(),
        actor: NearAccountIdSchema.optional(),
      }),
    )
    .output(eventIterator(ActivityFeedEventSchema))
    .errors({ BAD_REQUEST, SERVICE_UNAVAILABLE }),

  streamActivityEventsSse: oc
    .route({
      method: "GET",
      path: "/v1/events/stream",
      outputStructure: "detailed",
      summary: "Stream Activity events",
      description: "Streams trusted Activity events and supports resuming with Last-Event-ID.",
      tags: ["Activity"],
    })
    .input(
      z.object({
        source: z.string().min(2).max(100).regex(ACTIVITY_SOURCE_ID_REGEX).optional(),
        type: ActivityEventTypeNameSchema.optional(),
        actor: NearAccountIdSchema.optional(),
      }),
    )
    .output(ActivitySseResponseSchema)
    .errors({ BAD_REQUEST, SERVICE_UNAVAILABLE }),

  createThing: oc
    .route({
      method: "POST",
      path: "/things",
      summary: "Create a thing",
      description: "Creates a DB-backed thing via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
        payload: z.unknown(),
      }),
    )
    .output(CreatedThingSchema)
    .errors({
      UNAUTHORIZED,
      CONFLICT: { status: 409, message: "A thing with this ID already exists" },
    }),

  getThing: oc
    .route({
      method: "GET",
      path: "/things/{thingId}",
      summary: "Get a thing",
      description: "Returns a DB-backed thing by ID via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
      }),
    )
    .output(ThingSchema)
    .errors({ NOT_FOUND }),

  listThings: oc
    .route({
      method: "GET",
      path: "/things",
      summary: "List things",
      description:
        "Lists things from the template plugin with optional type filtering and cursor pagination.",
      tags: ["Things"],
    })
    .input(
      z.object({
        type: z.string().optional().describe("Filter by thing type"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(10)
          .describe("Maximum number of results to return"),
        cursor: z.string().optional().describe("Opaque cursor for the next page"),
      }),
    )
    .output(ListThingsSchema),

  deleteThing: oc
    .route({
      method: "DELETE",
      path: "/things/{thingId}",
      summary: "Delete a thing",
      description: "Removes a DB-backed thing by ID via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
      }),
    )
    .output(z.object({ success: z.literal(true) }))
    .errors({ UNAUTHORIZED, NOT_FOUND }),

  testError: oc
    .route({
      method: "GET",
      path: "/errors",
      summary: "Trigger a specific error kind",
      description:
        "Regression-test helper that throws the requested error kind so the host error surface can be validated.",
      tags: ["Testing"],
    })
    .input(
      z.object({
        kind: ErrorTestKindSchema.describe("Which error kind to trigger"),
      }),
    )
    .output(
      z.object({
        ok: z.literal(true).describe("Always true when no error is thrown"),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
});

export type ContractType = typeof contract;
