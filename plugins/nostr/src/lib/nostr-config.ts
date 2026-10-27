import { Context, Layer } from "effect";
import { nip19 } from "nostr-tools";
import { z } from "zod";

const DEFAULT_KV_API = "https://kv.main.fastnear.com";
const DEFAULT_BINDING_CONTRACT = "contextual.near";
const DEFAULT_BUZZ_RELAYS = "wss://nearbuilders.communities.buzz.xyz";

export const NostrVariablesSchema = z.object({
  relays: z
    .array(z.string())
    .default(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"])
    .describe("Default Nostr relay URLs"),
  clientName: z
    .string()
    .default("nostr.nearbuilders.org")
    .describe("Client identifier tag attached to each published event"),
  STANDARD_RELAYS: z
    .string()
    .optional()
    .describe("Comma-separated standard Nostr relays for the standard comment adapter"),
  BUZZ_RELAYS: z.string().default(DEFAULT_BUZZ_RELAYS).describe("Comma-separated Buzz relay URLs"),
  KV_API_URL: z.string().default(DEFAULT_KV_API).describe("FastNear KV API URL for bindings"),
  BINDING_CONTRACT: z
    .string()
    .default(DEFAULT_BINDING_CONTRACT)
    .describe("FastNear KV binding contract account"),
  CHALLENGE_EXPIRY_SECONDS: z.coerce
    .number()
    .default(300)
    .describe("Binding challenge expiry in seconds"),
});

export const NostrSecretsSchema = z.object({
  BUZZ_NSEC: z
    .string()
    .optional()
    .describe(
      "nsec/hex key for Buzz adapter NIP-42 relay auth (server identity only, never signs user events)",
    ),
  VAULT_DATABASE_URL: z
    .string()
    .optional()
    .describe("Postgres URL for the encrypted nsec vault. Omit to disable the vault."),
  VAULT_SECRET: z
    .string()
    .min(32)
    .optional()
    .describe(
      "32+ char key-encryption secret (AES-256-GCM KEK source). Required when VAULT_DATABASE_URL is set. Generate: openssl rand -base64 32",
    ),
});

export type NostrVariables = z.infer<typeof NostrVariablesSchema>;
export type NostrSecrets = z.infer<typeof NostrSecretsSchema>;

export interface NostrResolvedConfig {
  relays: string[];
  clientName: string;
  kvApiUrl: string;
  bindingContract: string;
  standardRelays: string[];
  buzzRelays: string[];
  buzzSecretKey: Uint8Array | undefined;
  challengeExpirySeconds: number;
}

function decodeSecret(value: string | undefined): Uint8Array | undefined {
  if (!value) return undefined;
  if (value.startsWith("nsec1")) {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") {
      throw new Error(`Invalid nsec value: expected nsec prefix, got '${decoded.type}'`);
    }
    return decoded.data;
  }
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Invalid hex secret key: must be 64 hex chars or nsec1...`);
  }
  return new Uint8Array(Buffer.from(value, "hex"));
}

export class NostrConfigTag extends Context.Service<NostrConfigTag, NostrResolvedConfig>()(
  "nostr/Config",
) {}

export function resolveNostrConfig(
  variables: NostrVariables,
  secrets: NostrSecrets,
): NostrResolvedConfig {
  const standardRelays = [
    ...new Set(
      variables.STANDARD_RELAYS?.trim()
        ? variables.STANDARD_RELAYS.split(",")
            .map((url) => url.trim())
            .filter(Boolean)
        : variables.relays,
    ),
  ];
  for (const relay of standardRelays) {
    const url = new URL(relay);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Standard relays must be ws:// or wss:// URLs without credentials");
    }
  }
  if (standardRelays.length === 0 || standardRelays.length > 10) {
    throw new Error("Configure between one and ten standard relays");
  }
  return {
    relays: standardRelays,
    clientName: variables.clientName,
    kvApiUrl: variables.KV_API_URL.trim() || DEFAULT_KV_API,
    bindingContract: variables.BINDING_CONTRACT.trim() || DEFAULT_BINDING_CONTRACT,
    standardRelays,
    buzzRelays: (variables.BUZZ_RELAYS || DEFAULT_BUZZ_RELAYS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    buzzSecretKey: decodeSecret(secrets.BUZZ_NSEC),
    challengeExpirySeconds: variables.CHALLENGE_EXPIRY_SECONDS,
  };
}

export const NostrConfigLive = (config: NostrResolvedConfig) =>
  Layer.succeed(NostrConfigTag, config);
