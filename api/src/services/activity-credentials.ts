import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import {
  type Event,
  type EventTemplate,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import {
  type ActivityMasterKeys,
  decryptActivitySecret,
  encryptActivitySecret,
} from "../activity/activity-credentials-crypto";
import { DatabaseTag } from "../db/layer";
import {
  activitySourceApiKeys as apiKeysTable,
  activitySigningIdentities as identitiesTable,
  activitySources as sourcesTable,
} from "../db/schema";

export interface ActivitySigningIdentityRecord {
  publicKey: string;
  bindingStatus: "pending" | "bound";
  boundNearAccountId: string | null;
  boundAt: string | null;
  keyVersion: string;
  createdBy: string | null;
  createdAt: string;
  retiredBy: string | null;
  retirementReason: string | null;
  retiredAt: string | null;
}

export interface ActivityCredentialsService {
  createSigningIdentity(
    organizationId: string,
    sourceId: string,
    actorId: string,
  ): Promise<ActivitySigningIdentityRecord>;
  prepareSigningIdentityBinding(
    organizationId: string,
    sourceId: string,
    nearAccountId: string,
  ): Promise<ActivityBindingWrite>;
  getSigningIdentity(
    organizationId: string,
    sourceId: string,
  ): Promise<ActivitySigningIdentityRecord | null>;
  confirmSigningIdentityBinding(
    organizationId: string,
    sourceId: string,
    nearAccountId: string,
  ): Promise<ActivitySigningIdentityRecord>;
  createApiKey(
    organizationId: string,
    sourceId: string,
    name: string,
  ): Promise<{ secret: string; apiKey: ActivitySourceApiKeyRecord }>;
  listApiKeys(organizationId: string, sourceId: string): Promise<ActivitySourceApiKeyRecord[]>;
  revokeApiKey(
    organizationId: string,
    sourceId: string,
    apiKeyId: string,
  ): Promise<ActivitySourceApiKeyRecord>;
  authenticateEventWriteKey(secret: string): Promise<ActivityEventWriteCredential>;
  getInternalEventWriteCredential(sourceId: string): Promise<ActivityEventWriteCredential>;
  rotateSigningIdentity(
    organizationId: string,
    sourceId: string,
    actorId: string,
    reason: string,
  ): Promise<ActivitySigningIdentityRecord>;
  listSigningIdentities(
    organizationId: string,
    sourceId: string,
  ): Promise<ActivitySigningIdentityRecord[]>;
  signActivityEvent(
    credential: ActivityEventWriteCredential,
    template: EventTemplate,
  ): Promise<Event>;
}

export interface ActivitySourceApiKeyRecord {
  id: string;
  sourceId: string;
  name: string;
  prefix: string;
  permissions: ["event:write"];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ActivityEventWriteCredential {
  keyId: string;
  sourceId: string;
  organizationId: string;
  publicKey: string;
  permissions: ["event:write"];
}

export interface ActivityBindingWrite {
  contractId: string;
  methodName: "__fastdata_kv";
  key: string;
  value: string;
  args: Record<string, string>;
  gas: string;
  attachedDeposit: string;
}

export interface ActivityBindingConfig {
  contractId: string;
  relay: string;
  kvApiUrl: string;
}

export class ActivityCredentialsTag extends Context.Tag("api/ActivityCredentials")<
  ActivityCredentialsService,
  ActivityCredentialsService
>() {}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toIdentityRecord(
  identity: typeof identitiesTable.$inferSelect,
): ActivitySigningIdentityRecord {
  return {
    publicKey: identity.publicKey,
    bindingStatus: identity.bindingStatus,
    boundNearAccountId: identity.boundNearAccountId,
    boundAt: identity.boundAt ? toIsoTimestamp(identity.boundAt) : null,
    keyVersion: identity.encryptionKeyVersion,
    createdBy: identity.createdBy,
    createdAt: toIsoTimestamp(identity.createdAt),
    retiredBy: identity.retiredBy,
    retirementReason: identity.retirementReason,
    retiredAt: identity.retiredAt ? toIsoTimestamp(identity.retiredAt) : null,
  };
}

function toApiKeyRecord(
  apiKey: typeof apiKeysTable.$inferSelect,
  sourceId: string,
): ActivitySourceApiKeyRecord {
  return {
    id: apiKey.id,
    sourceId,
    name: apiKey.name,
    prefix: apiKey.prefix,
    permissions: ["event:write"],
    createdAt: toIsoTimestamp(apiKey.createdAt),
    lastUsedAt: apiKey.lastUsedAt ? toIsoTimestamp(apiKey.lastUsedAt) : null,
    revokedAt: apiKey.revokedAt ? toIsoTimestamp(apiKey.revokedAt) : null,
  };
}

function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function hasCurrentBinding(
  source: Pick<typeof sourcesTable.$inferSelect, "nearAccountId">,
  identity: Pick<typeof identitiesTable.$inferSelect, "bindingStatus" | "boundNearAccountId">,
): boolean {
  return identity.bindingStatus === "bound" && identity.boundNearAccountId === source.nearAccountId;
}

function createEncryptedSigningIdentity(
  sourceRecordId: string,
  masterKeys: ActivityMasterKeys,
  createdBy: string,
): typeof identitiesTable.$inferInsert {
  const privateKey = generateSecretKey();
  try {
    const encrypted = encryptActivitySecret(privateKey, masterKeys);
    return {
      sourceRecordId,
      createdBy,
      publicKey: getPublicKey(privateKey),
      encryptedPrivateKey: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
      encryptionKeyVersion: encrypted.keyVersion,
    };
  } finally {
    privateKey.fill(0);
  }
}

function toOrpcError(error: unknown): ORPCError<string, unknown> {
  return error instanceof ORPCError
    ? error
    : new ORPCError("INTERNAL_SERVER_ERROR", { message: "Activity credential operation failed" });
}

export const ActivityCredentialsLive = (
  masterKeys: ActivityMasterKeys,
  bindingConfig: ActivityBindingConfig,
) =>
  Layer.effect(
    ActivityCredentialsTag,
    Effect.gen(function* () {
      const db = yield* DatabaseTag;

      const findActiveIdentity = async (organizationId: string, sourceId: string) => {
        const [result] = await db
          .select({ source: sourcesTable, identity: identitiesTable })
          .from(sourcesTable)
          .innerJoin(
            identitiesTable,
            and(
              eq(identitiesTable.sourceRecordId, sourcesTable.id),
              isNull(identitiesTable.retiredAt),
            ),
          )
          .where(
            and(
              eq(sourcesTable.sourceId, sourceId),
              eq(sourcesTable.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!result) {
          throw new ORPCError("NOT_FOUND", {
            message: "Active Activity Source signing identity not found",
          });
        }
        return result;
      };

      const service: ActivityCredentialsService = {
        createSigningIdentity: async (organizationId, sourceId, actorId) => {
          try {
            return await db.transaction(async (tx) => {
              const [source] = await tx
                .select()
                .from(sourcesTable)
                .where(
                  and(
                    eq(sourcesTable.sourceId, sourceId),
                    eq(sourcesTable.organizationId, organizationId),
                  ),
                )
                .limit(1);
              if (!source) {
                throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
              }
              if (source.approvalStatus !== "approved") {
                throw new ORPCError("FORBIDDEN", {
                  message: "Activity Source is not approved",
                });
              }
              const [existing] = await tx
                .select({ id: identitiesTable.id })
                .from(identitiesTable)
                .where(
                  and(
                    eq(identitiesTable.sourceRecordId, source.id),
                    isNull(identitiesTable.retiredAt),
                  ),
                )
                .limit(1);
              if (existing) {
                throw new ORPCError("CONFLICT", {
                  message: "Activity Source already has an active signing identity",
                });
              }

              const [created] = await tx
                .insert(identitiesTable)
                .values(createEncryptedSigningIdentity(source.id, masterKeys, actorId))
                .returning();
              if (!created) throw new Error("Signing Identity was not created");
              return toIdentityRecord(created);
            });
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        prepareSigningIdentityBinding: async (organizationId, sourceId, nearAccountId) => {
          try {
            const result = await findActiveIdentity(organizationId, sourceId);
            if (result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", { message: "Activity Source is not approved" });
            }
            if (result.source.nearAccountId !== nearAccountId) {
              throw new ORPCError("FORBIDDEN", {
                message: "Connect the Activity Source NEAR account to authorize this binding",
              });
            }
            const now = Math.floor(Date.now() / 1_000);
            const challenge = `bind:${nearAccountId}:${now + 300}:near-nostr-bindings`;
            const privateKey = decryptActivitySecret(
              {
                ciphertext: result.identity.encryptedPrivateKey,
                iv: result.identity.encryptionIv,
                authTag: result.identity.encryptionAuthTag,
                keyVersion: result.identity.encryptionKeyVersion,
              },
              masterKeys,
            );
            try {
              const event = finalizeEvent(
                {
                  kind: 27235,
                  created_at: now,
                  tags: [],
                  content: challenge,
                },
                privateKey,
              );
              const proof = JSON.stringify({
                nostrPubkey: event.pubkey,
                challenge,
                eventId: event.id,
                verifiedBy: nearAccountId,
                verifiedAt: now,
              });
              const key = `nostr/${nearAccountId}`;
              const value = JSON.stringify({
                npub: event.pubkey,
                relay: bindingConfig.relay,
                proof,
                bound_at: now,
              });
              return {
                contractId: bindingConfig.contractId,
                methodName: "__fastdata_kv",
                key,
                value,
                args: { [key]: value },
                gas: "300000000000000",
                attachedDeposit: "10000000000000000000000",
              };
            } finally {
              privateKey.fill(0);
            }
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        getSigningIdentity: async (organizationId, sourceId) => {
          try {
            const [source] = await db
              .select({ id: sourcesTable.id })
              .from(sourcesTable)
              .where(
                and(
                  eq(sourcesTable.sourceId, sourceId),
                  eq(sourcesTable.organizationId, organizationId),
                ),
              )
              .limit(1);
            if (!source) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }
            const [identity] = await db
              .select()
              .from(identitiesTable)
              .where(
                and(
                  eq(identitiesTable.sourceRecordId, source.id),
                  isNull(identitiesTable.retiredAt),
                ),
              )
              .limit(1);
            return identity ? toIdentityRecord(identity) : null;
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        confirmSigningIdentityBinding: async (organizationId, sourceId, nearAccountId) => {
          try {
            const result = await findActiveIdentity(organizationId, sourceId);
            if (result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", { message: "Activity Source is not approved" });
            }
            if (result.source.nearAccountId !== nearAccountId) {
              throw new ORPCError("FORBIDDEN", {
                message: "Connect the Activity Source NEAR account to confirm this binding",
              });
            }
            const accountPath = encodeURIComponent(nearAccountId);
            const bindingUrl = `${bindingConfig.kvApiUrl.replace(/\/$/, "")}/v0/latest/${encodeURIComponent(bindingConfig.contractId)}/${accountPath}/nostr/${accountPath}`;
            let response: Response;
            try {
              response = await fetch(bindingUrl, { signal: AbortSignal.timeout(5_000) });
            } catch {
              throw new ORPCError("BAD_REQUEST", {
                message: "The NEAR-to-Nostr binding is not available yet",
              });
            }
            if (!response.ok) {
              throw new ORPCError("BAD_REQUEST", {
                message: "The NEAR-to-Nostr binding is not available yet",
              });
            }
            const data = (await response.json()) as { entries?: Array<{ value?: unknown }> };
            const rawBinding = data.entries?.[0]?.value;
            const binding =
              typeof rawBinding === "string"
                ? (JSON.parse(rawBinding) as { npub?: unknown; bound_at?: unknown })
                : (rawBinding as { npub?: unknown; bound_at?: unknown } | undefined);
            if (!binding || binding.npub !== result.identity.publicKey) {
              throw new ORPCError("BAD_REQUEST", {
                message: "The NEAR-to-Nostr binding does not match this signing identity",
              });
            }

            const boundAt =
              typeof binding.bound_at === "number"
                ? new Date(binding.bound_at * 1_000)
                : new Date();
            const [updated] = await db
              .update(identitiesTable)
              .set({
                bindingStatus: "bound",
                boundNearAccountId: nearAccountId,
                boundAt,
              })
              .where(eq(identitiesTable.id, result.identity.id))
              .returning();
            if (!updated) throw new Error("Signing identity binding was not confirmed");
            return toIdentityRecord(updated);
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        createApiKey: async (organizationId, sourceId, name) => {
          try {
            const result = await findActiveIdentity(organizationId, sourceId);
            if (result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", { message: "Activity Source is not approved" });
            }
            if (!hasCurrentBinding(result.source, result.identity)) {
              throw new ORPCError("FORBIDDEN", {
                message: "Bind the Activity Source signing identity before creating an API key",
              });
            }

            const secret = `act_${randomBytes(32).toString("base64url")}`;
            const [created] = await db
              .insert(apiKeysTable)
              .values({
                sourceRecordId: result.source.id,
                name,
                prefix: secret.slice(0, 12),
                secretHash: hashApiKey(secret),
                permission: "event:write",
              })
              .returning();
            if (!created) throw new Error("Source API Key was not created");
            return { secret, apiKey: toApiKeyRecord(created, sourceId) };
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        listApiKeys: async (organizationId, sourceId) => {
          try {
            const [source] = await db
              .select({ id: sourcesTable.id })
              .from(sourcesTable)
              .where(
                and(
                  eq(sourcesTable.sourceId, sourceId),
                  eq(sourcesTable.organizationId, organizationId),
                ),
              )
              .limit(1);
            if (!source) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }
            const keys = await db
              .select()
              .from(apiKeysTable)
              .where(eq(apiKeysTable.sourceRecordId, source.id))
              .orderBy(apiKeysTable.createdAt);
            return keys.map((apiKey) => toApiKeyRecord(apiKey, sourceId));
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        revokeApiKey: async (organizationId, sourceId, apiKeyId) => {
          try {
            const [result] = await db
              .select({ source: sourcesTable, apiKey: apiKeysTable })
              .from(sourcesTable)
              .innerJoin(apiKeysTable, eq(apiKeysTable.sourceRecordId, sourcesTable.id))
              .where(
                and(
                  eq(sourcesTable.sourceId, sourceId),
                  eq(sourcesTable.organizationId, organizationId),
                  eq(apiKeysTable.id, apiKeyId),
                ),
              )
              .limit(1);
            if (!result) {
              throw new ORPCError("NOT_FOUND", { message: "Source API Key not found" });
            }
            if (result.apiKey.revokedAt) return toApiKeyRecord(result.apiKey, sourceId);
            const [revoked] = await db
              .update(apiKeysTable)
              .set({ revokedAt: new Date() })
              .where(eq(apiKeysTable.id, apiKeyId))
              .returning();
            if (!revoked) throw new Error("Source API Key was not revoked");
            return toApiKeyRecord(revoked, sourceId);
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        authenticateEventWriteKey: async (secret) => {
          try {
            const [result] = await db
              .select({ source: sourcesTable, identity: identitiesTable, apiKey: apiKeysTable })
              .from(apiKeysTable)
              .innerJoin(sourcesTable, eq(sourcesTable.id, apiKeysTable.sourceRecordId))
              .innerJoin(
                identitiesTable,
                and(
                  eq(identitiesTable.sourceRecordId, sourcesTable.id),
                  isNull(identitiesTable.retiredAt),
                ),
              )
              .where(eq(apiKeysTable.secretHash, hashApiKey(secret)))
              .limit(1);
            if (!result || result.apiKey.revokedAt || result.apiKey.permission !== "event:write") {
              throw new ORPCError("UNAUTHORIZED", { message: "Invalid Source API Key" });
            }
            if (result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source is not approved for ingestion",
              });
            }
            if (!hasCurrentBinding(result.source, result.identity)) {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source signing identity is not bound",
              });
            }
            await db
              .update(apiKeysTable)
              .set({ lastUsedAt: new Date() })
              .where(eq(apiKeysTable.id, result.apiKey.id));
            return {
              keyId: result.apiKey.id,
              sourceId: result.source.sourceId,
              organizationId: result.source.organizationId,
              publicKey: result.identity.publicKey,
              permissions: ["event:write"],
            };
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        getInternalEventWriteCredential: async (sourceId) => {
          try {
            const [result] = await db
              .select({ source: sourcesTable, identity: identitiesTable })
              .from(sourcesTable)
              .innerJoin(
                identitiesTable,
                and(
                  eq(identitiesTable.sourceRecordId, sourcesTable.id),
                  isNull(identitiesTable.retiredAt),
                ),
              )
              .where(eq(sourcesTable.sourceId, sourceId))
              .limit(1);
            if (!result || result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source is not approved for ingestion",
              });
            }
            if (!hasCurrentBinding(result.source, result.identity)) {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source signing identity is not bound",
              });
            }
            return {
              keyId: "internal:github",
              sourceId: result.source.sourceId,
              organizationId: result.source.organizationId,
              publicKey: result.identity.publicKey,
              permissions: ["event:write"],
            };
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        rotateSigningIdentity: async (organizationId, sourceId, actorId, reason) => {
          try {
            return await db.transaction(async (tx) => {
              const [result] = await tx
                .select({ source: sourcesTable, identity: identitiesTable })
                .from(sourcesTable)
                .innerJoin(
                  identitiesTable,
                  and(
                    eq(identitiesTable.sourceRecordId, sourcesTable.id),
                    isNull(identitiesTable.retiredAt),
                  ),
                )
                .where(
                  and(
                    eq(sourcesTable.sourceId, sourceId),
                    eq(sourcesTable.organizationId, organizationId),
                  ),
                )
                .limit(1);
              if (!result) {
                throw new ORPCError("NOT_FOUND", {
                  message: "Active Activity Source signing identity not found",
                });
              }
              if (result.source.approvalStatus !== "approved") {
                throw new ORPCError("FORBIDDEN", { message: "Activity Source is not approved" });
              }

              await tx
                .update(identitiesTable)
                .set({ retiredAt: new Date(), retiredBy: actorId, retirementReason: reason })
                .where(eq(identitiesTable.id, result.identity.id));
              const [created] = await tx
                .insert(identitiesTable)
                .values(createEncryptedSigningIdentity(result.source.id, masterKeys, actorId))
                .returning();
              if (!created) throw new Error("Signing Identity was not rotated");
              return toIdentityRecord(created);
            });
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        listSigningIdentities: async (organizationId, sourceId) => {
          try {
            const [source] = await db
              .select({ id: sourcesTable.id })
              .from(sourcesTable)
              .where(
                and(
                  eq(sourcesTable.sourceId, sourceId),
                  eq(sourcesTable.organizationId, organizationId),
                ),
              )
              .limit(1);
            if (!source) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }
            const identities = await db
              .select()
              .from(identitiesTable)
              .where(eq(identitiesTable.sourceRecordId, source.id))
              .orderBy(identitiesTable.createdAt);
            return identities.map(toIdentityRecord);
          } catch (error) {
            throw toOrpcError(error);
          }
        },

        signActivityEvent: async (credential, template) => {
          try {
            const [result] = await db
              .select({ source: sourcesTable, identity: identitiesTable })
              .from(sourcesTable)
              .innerJoin(
                identitiesTable,
                and(
                  eq(identitiesTable.sourceRecordId, sourcesTable.id),
                  isNull(identitiesTable.retiredAt),
                ),
              )
              .where(eq(sourcesTable.sourceId, credential.sourceId))
              .limit(1);
            if (!result || result.source.approvalStatus !== "approved") {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source is not approved for signing",
              });
            }
            if (!hasCurrentBinding(result.source, result.identity)) {
              throw new ORPCError("FORBIDDEN", {
                message: "Activity Source signing identity is not bound",
              });
            }
            if (result.identity.publicKey !== credential.publicKey) {
              throw new ORPCError("FORBIDDEN", {
                message: "Source API Key is not valid for the active Signing Identity",
              });
            }
            const privateKey = decryptActivitySecret(
              {
                ciphertext: result.identity.encryptedPrivateKey,
                iv: result.identity.encryptionIv,
                authTag: result.identity.encryptionAuthTag,
                keyVersion: result.identity.encryptionKeyVersion,
              },
              masterKeys,
            );
            try {
              return finalizeEvent(template, privateKey);
            } finally {
              privateKey.fill(0);
            }
          } catch (error) {
            throw toOrpcError(error);
          }
        },
      };

      return service;
    }),
  );
