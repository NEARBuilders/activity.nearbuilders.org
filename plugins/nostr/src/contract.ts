import { BAD_REQUEST, UNAUTHORIZED } from "every-plugin/errors";
import "@orpc/openapi/extensions/route";
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { RelayErrors } from "./lib/relay-errors";
import {
  NostrCommentSchema,
  NostrEventSchema,
  ProfileSchema,
  PublishResultSchema,
  RawRelayInputSchema,
} from "./lib/schemas";

// ── Binding & identity schemas ──

const BindingOutput = z.object({
  npub: z.string(),
  relay: z.string(),
  proof: z.string(),
  boundAt: z.number().int(),
});

const IdentityOutput = z.object({
  nearAccountId: z.string(),
  nostrPubkey: z.string(),
  relay: z.string(),
  proof: z.string(),
  boundAt: z.number().int(),
  profile: ProfileSchema.optional().nullable(),
});

export const contract = oc.router({
  // ── Identity & health ──

  listRelays: oc
    .route({
      method: "GET",
      path: "/nostr/relays",
      summary: "List configured relays",
      tags: ["Relays"],
    })
    .output(
      z.object({
        relays: z.array(z.string()),
      }),
    ),

  ping: oc
    .route({
      method: "GET",
      path: "/nostr/ping",
      summary: "Health check",
      tags: ["Health"],
    })
    .output(
      z.object({
        status: z.literal("ok"),
        timestamp: z.string().datetime(),
      }),
    ),

  // ── Binding routes (FastNear KV-backed bindings + challenge/verify) ──

  getBinding: oc
    .route({ method: "GET", path: "/v1/binding/{nearAccountId}" })
    .input(z.object({ nearAccountId: z.string().min(1) }))
    .output(BindingOutput.nullable())
    .errors({ BAD_REQUEST }),

  getIdentity: oc
    .route({ method: "GET", path: "/v1/identity/{nearAccountId}" })
    .input(
      z.object({
        nearAccountId: z.string().min(1),
        enrichProfile: z.boolean().optional().default(true),
      }),
    )
    .output(IdentityOutput.nullable())
    .errors({ BAD_REQUEST }),

  createChallenge: oc
    .route({ method: "POST", path: "/v1/binding/challenge" })
    .input(z.object({}))
    .output(
      z.object({
        challenge: z.string(),
        expiresAt: z.number().int(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  verifyBinding: oc
    .route({ method: "POST", path: "/v1/binding/verify" })
    .input(
      z.object({
        event: z.object({
          id: z.string(),
          pubkey: z.string(),
          content: z.string(),
          tags: z.array(z.array(z.string())),
          created_at: z.number().int(),
          sig: z.string(),
        }),
      }),
    )
    .output(
      z.object({
        valid: z.boolean(),
        nearAccountId: z.string(),
        nostrPubkey: z.string(),
        proof: z.string(),
      }),
    )
    .errors({ UNAUTHORIZED, BAD_REQUEST }),

  prepareBindingWrite: oc
    .route({ method: "POST", path: "/v1/binding/prepare" })
    .input(
      z.object({
        nostrPubkey: z.string(),
        relay: z.string(),
        proof: z.string(),
      }),
    )
    .output(
      z.object({
        contractId: z.string(),
        methodName: z.literal("__fastdata_kv"),
        key: z.string(),
        value: z.string(),
        args: z.record(z.string(), z.string()),
        gas: z.string(),
        attachedDeposit: z.string(),
      }),
    )
    .errors({ BAD_REQUEST }),

  // From nostr-comments: relay-adapter-backed comments + low-level relay access
  listComments: oc
    .route({ method: "GET", path: "/v1/comments" })
    .input(
      z.object({
        target: z.string().min(1),
        targetType: z.string().default("project"),
        adapterType: z.enum(["standard", "buzz"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        since: z.number().int().optional(),
        enrich: z.boolean().optional(),
        requireBound: z.boolean().optional(),
        requireVerified: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        data: z.array(NostrCommentSchema),
        meta: z.object({ count: z.number().int() }),
      }),
    )
    .errors({ BAD_REQUEST }),

  createComment: oc
    .route({ method: "POST", path: "/v1/comments" })
    .input(
      z.object({
        event: z.object({
          id: z.string(),
          pubkey: z.string(),
          kind: z.number().int().default(1111),
          content: z.string(),
          tags: z.array(z.array(z.string())),
          created_at: z.number().int(),
          sig: z.string(),
        }),
        target: z.string().min(1),
        targetType: z.string().default("project"),
        adapterType: z.enum(["standard", "buzz"]).optional(),
      }),
    )
    .output(PublishResultSchema)
    .errors({ BAD_REQUEST }),

  listChannels: oc
    .route({ method: "GET", path: "/v1/buzz/channels" })
    .errors({ BAD_REQUEST })
    .output(
      z.object({
        data: z.array(
          z.object({
            id: z.string(),
            name: z.string().optional().nullable(),
            members: z.number().int().optional().nullable(),
          }),
        ),
      }),
    ),

  queryEvents: oc
    .route({ method: "POST", path: "/v1/nostr/query" })
    .input(RawRelayInputSchema)
    .output(
      z.object({
        events: z.array(NostrEventSchema),
        meta: z.object({ limited: z.boolean() }),
      }),
    )
    .errors({ BAD_REQUEST, ...RelayErrors }),

  subscribeEvents: oc
    .route({ method: "POST", path: "/v1/nostr/subscribe" })
    .input(RawRelayInputSchema)
    .output(eventIterator(NostrEventSchema))
    .errors({ BAD_REQUEST, ...RelayErrors }),

  publishEvent: oc
    .route({ method: "POST", path: "/v1/nostr/publish" })
    .input(
      z.object({
        event: NostrEventSchema,
        relays: z.array(z.string()).min(1).max(10).optional(),
      }),
    )
    .output(PublishResultSchema)
    .errors({ BAD_REQUEST, ...RelayErrors }),

  getProfile: oc
    .route({ method: "GET", path: "/v1/nostr/profile/{pubkey}" })
    .input(z.object({ pubkey: z.string().min(1) }))
    .output(ProfileSchema.nullable())
    .errors({ BAD_REQUEST }),

  // ── Encrypted nsec vault (server-side AES-256-GCM at rest) ──
  // Ownership always derives from the authenticated session; requests
  // cannot address another account's vault entry.

  vaultPut: oc
    .route({ method: "POST", path: "/v1/nostr/vault", summary: "Store nsec encrypted at rest" })
    .input(
      z.object({
        nsec: z
          .string()
          .min(60)
          .max(120)
          .regex(/^nsec1/),
      }),
    )
    .output(z.object({ createdAt: z.string() }))
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  vaultGet: oc
    .route({
      method: "GET",
      path: "/v1/nostr/vault",
      summary: "Recover stored nsec (owner session only)",
    })
    .input(z.object({}))
    .output(z.object({ nsec: z.string(), createdAt: z.string() }).nullable())
    .errors({ UNAUTHORIZED }),

  vaultDelete: oc
    .route({ method: "DELETE", path: "/v1/nostr/vault" })
    .input(z.object({}))
    .output(z.object({ deleted: z.boolean() }))
    .errors({ UNAUTHORIZED }),
});

export type ContractType = typeof contract;
