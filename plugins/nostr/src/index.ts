import type { DecoratedMiddleware } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import type { z } from "zod";
import { contract } from "./contract";
import type { AuthContext } from "./lib/auth";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import {
  NostrConfigLive,
  NostrSecretsSchema,
  NostrVariablesSchema,
  resolveNostrConfig,
} from "./lib/nostr-config";
import type { PluginsClient } from "./lib/plugins-client.gen";
import type { NostrFilterSchema } from "./lib/schemas";
import { BuzzAdapterLive, StandardAdapterLive } from "./nostr-core/adapters";
import type { NostrFilter } from "./nostr-core/types";
import { BindingService, BindingServiceLive } from "./services/binding";
import { NostrCommentService, NostrCommentServiceLive } from "./services/nostr";
import { VaultService, VaultServiceLive } from "./services/vault";

class NostrServices extends Context.Service<
  NostrServices,
  {
    relays: string[];
    binding: BindingService["Service"];
    comments: NostrCommentService["Service"];
    vault: VaultService["Service"];
  }
>()("nostr/Services") {}

export default createPlugin.withPlugins<PluginsClient>()({
  variables: NostrVariablesSchema,

  secrets: NostrSecretsSchema,

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.sync(() => {
      const resolved = resolveNostrConfig(config.variables, config.secrets);
      const configLayer = NostrConfigLive(resolved);

      const services = Layer.mergeAll(
        BindingServiceLive.pipe(Layer.provide(configLayer)),
        NostrCommentServiceLive.pipe(
          Layer.provide(BuzzAdapterLive),
          Layer.provide(StandardAdapterLive),
          Layer.provide(configLayer),
        ),
        VaultServiceLive,
      );

      return Layer.effect(
        NostrServices,
        Effect.gen(function* () {
          const binding = yield* BindingService;
          const comments = yield* NostrCommentService;
          const vault = yield* VaultService;
          yield* Effect.addFinalizer(() => Effect.logInfo("[Nostr] Shutdown"));
          yield* Effect.logInfo("[Nostr] Services Initialized");
          return { relays: resolved.relays, binding, comments, vault };
        }),
      ).pipe(Layer.provide(services));
    }),

  createRouter: (builder) => {
    const nostr = (context: { "effect/context": Context.Context<NostrServices> }) =>
      Context.get(context["effect/context"], NostrServices);
    const mw = createAuthMiddleware(builder);

    // DEV-ONLY: local `bos dev` runs the auth plugin remotely; without a cloud
    // DB the session cookie can't resolve, so protected RPCs 401. When the
    // NOSTR_DEV_FAKE_AUTH env var is set, accept a fixed test identity instead.
    // MUST be unset for production builds. Remove before opening a PR.
    const DEV_FAKE_AUTH = process.env.NOSTR_DEV_FAKE_AUTH === "1";
    const devRequireAuth = ((_mw, builder_) => {
      if (!DEV_FAKE_AUTH) return null;
      const fakeAuth = {
        requireAuth: builder_.middleware(async ({ next }: { next: any }) =>
          next({ context: { userId: "dev-user", user: { id: "dev-user", role: "admin" } } }),
        ) as any,
        requireRole: (_roles: readonly string[]) =>
          builder_.middleware(async ({ next }: { next: any }) => next({ context: {} })) as any,
        requireOrganization: builder_.middleware(async ({ next }: { next: any }) =>
          next({ context: { organization: { activeOrganizationId: "dev-org" } } }),
        ) as any,
        requireAuthOrApiKey: builder_.middleware(async ({ next }: { next: any }) =>
          next({ context: {} }),
        ) as any,
        requireAdmin: builder_.middleware(async ({ next }: { next: any }) =>
          next({ context: {} }),
        ) as any,
      };
      return fakeAuth;
    })(mw, builder);

    const requireNearAccount = builder.middleware(
      async ({ context, next }: { context: AuthContext; next: any }) => {
        const nearAccountId = context.near?.primaryAccountId;
        if (!nearAccountId) {
          if (DEV_FAKE_AUTH) {
            return next({ context: { nearAccountId: "jeanguest.testnet" } });
          }
          throw new ORPCError("UNAUTHORIZED", {
            message: "NEAR account required. Connect a NEAR wallet first.",
          });
        }
        return next({ context: { nearAccountId } });
      },
    ) as DecoratedMiddleware<AuthContext, { nearAccountId: string }, any, any, any>;

    const auth = devRequireAuth ?? mw;

    return {
      listRelays: builder.listRelays.handler(async ({ context }) => ({
        relays: nostr(context).relays,
      })),

      ping: builder.ping.handler(async () => ({
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      getBinding: builder.getBinding.handler(({ input, context }) =>
        runEffect(nostr(context).binding.getBindingOutput(input.nearAccountId)),
      ),

      getIdentity: builder.getIdentity.handler(({ input, context }) =>
        runEffect(nostr(context).binding.getIdentity(input.nearAccountId, input.enrichProfile)),
      ),

      createChallenge: builder.createChallenge
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ context }) =>
          runEffect(nostr(context).binding.createChallenge(context.nearAccountId)),
        ),

      verifyBinding: builder.verifyBinding
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(async ({ input, context }) => {
          const result = await runEffect(
            nostr(context).binding.verifyChallenge(input.event, context.nearAccountId),
          );
          return {
            valid: result.valid,
            nearAccountId: context.nearAccountId,
            nostrPubkey: result.nostrPubkey,
            proof: result.proof,
          };
        }),

      prepareBindingWrite: builder.prepareBindingWrite
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ input, context }) =>
          runEffect(
            nostr(context).binding.prepareBindingWrite({
              nostrPubkey: input.nostrPubkey,
              relay: input.relay,
              proof: input.proof,
              nearAccountId: context.nearAccountId,
            }),
          ),
        ),

      listComments: builder.listComments.handler(({ input, context }) =>
        runEffect(
          nostr(context).comments.listComments({
            target: input.target,
            targetType: input.targetType,
            adapterType: input.adapterType ?? "standard",
            limit: input.limit,
            since: input.since,
            enrich: input.enrich,
            requireBound: input.requireBound,
            requireVerified: input.requireVerified,
          }),
        ).then((result) => ({ data: result, meta: { count: result.length } })),
      ),

      createComment: builder.createComment
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ input, context }) =>
          runEffect(
            nostr(context).comments.publishSigned({
              event: input.event,
              target: input.target,
              targetType: input.targetType,
              adapterType: input.adapterType ?? "standard",
            }),
          ),
        ),

      listChannels: builder.listChannels.handler(({ context }) =>
        runEffect(nostr(context).comments.listChannels("buzz")).then((data) => ({ data })),
      ),

      vaultPut: builder.vaultPut
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ input, context }) =>
          runEffect(nostr(context).vault.store(context.nearAccountId, input.nsec)),
        ),

      vaultGet: builder.vaultGet
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ context }) => runEffect(nostr(context).vault.load(context.nearAccountId))),

      vaultDelete: builder.vaultDelete
        .use(auth.requireAuth)
        .use(requireNearAccount)
        .handler(({ context }) =>
          runEffect(nostr(context).vault.remove(context.nearAccountId)).then((deleted) => ({
            deleted,
          })),
        ),

      queryEvents: builder.queryEvents.handler(({ input, context, signal }) =>
        runEffect(
          nostr(context).comments.rawQuery({
            filter: toRelayFilter(input.filter),
            relays: input.relays,
            signal,
          }),
        ),
      ),

      subscribeEvents: builder.subscribeEvents.handler(async function* ({
        input,
        context,
        signal,
      }) {
        const stream = await runEffect(
          nostr(context).comments.rawSubscribe({
            filter: toRelayFilter(input.filter),
            relays: input.relays,
            signal,
          }),
        );
        yield* stream;
      }),

      publishEvent: builder.publishEvent.handler(({ input, context }) =>
        runEffect(nostr(context).comments.rawPublish({ event: input.event, relays: input.relays })),
      ),

      getProfile: builder.getProfile.handler(({ input, context }) =>
        runEffect(nostr(context).comments.getProfile(input.pubkey)),
      ),
    };
  },
});

function toRelayFilter(input: z.infer<typeof NostrFilterSchema>): NostrFilter {
  const { tags, ...filter } = input;
  const result: NostrFilter = { ...filter };
  for (const { tag, values } of tags ?? []) {
    const key = `#${tag}` as const;
    result[key] = [...new Set([...(result[key] ?? []), ...values])];
  }
  return result;
}
