import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { Context, Effect, Layer } from "effect";

// pg is loaded lazily via createRequire: a static import would pull pg's
// ESM-fragile class chain into the Module Federation bundle, which breaks
// at runtime (`Class extends value is not a constructor`). Resolving it
// from node_modules at call time keeps the bundle clean.
type PgPool = import("pg").Pool;
const require = createRequire(import.meta.url);
let PgPoolCtor: typeof import("pg")["Pool"] | null = null;
function getPoolCtor() {
  if (!PgPoolCtor) PgPoolCtor = require("pg").Pool;
  return PgPoolCtor;
}

// ── Crypto (AES-256-GCM envelope) ─────────────────────────────────────

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null;

function deriveKey(secret: string): Buffer {
  if (cachedKey && cachedKeySource === secret) return cachedKey;
  cachedKey = createHash("sha256").update(secret, "utf8").digest();
  cachedKeySource = secret;
  return cachedKey;
}

export function encryptNsec(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptNsec(secret: string, blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("vault: malformed ciphertext envelope");
  }
  const ivB64 = parts[1];
  const ctB64 = parts[2];
  const tagB64 = parts[3];
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error("vault: malformed ciphertext envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

export function nsecFingerprint(nsec: string): string {
  return createHash("sha256").update(nsec, "utf8").digest("hex").slice(0, 16);
}

// ── Service ───────────────────────────────────────────────────────────

export interface VaultEntry {
  nsec: string;
  createdAt: string;
}

export class VaultService extends Context.Service<
  VaultService,
  {
    store(nearAccount: string, nsec: string): Effect.Effect<{ createdAt: string }, Error>;
    load(nearAccount: string): Effect.Effect<VaultEntry | null, Error>;
    remove(nearAccount: string): Effect.Effect<boolean, Error>;
  }
>()("nostr.VaultService") {}

export const VaultServiceLive = Layer.effect(
  VaultService,
  Effect.gen(function* () {
    const dbUrl = process.env.VAULT_DATABASE_URL;
    const secret = process.env.VAULT_SECRET;
    if (!dbUrl || !secret) {
      // Vault disabled: every call fails softly at the router layer.
      yield* Effect.logWarning(
        "[Vault] VAULT_DATABASE_URL/VAULT_SECRET not set — nsec vault disabled",
      );
      return {
        store: () => Effect.fail(new Error("Vault disabled: VAULT_DATABASE_URL not configured")),
        load: () => Effect.fail(new Error("Vault disabled: VAULT_DATABASE_URL not configured")),
        remove: () => Effect.fail(new Error("Vault disabled: VAULT_DATABASE_URL not configured")),
      };
    }

    const pool: PgPool = new (getPoolCtor() as NonNullable<typeof import("pg")["Pool"]>)({
      connectionString: dbUrl,
      max: 3,
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => undefined),
      () => Effect.sync(() => undefined),
    );

    yield* Effect.tryPromise({
      try: () =>
        pool.query(`
          CREATE TABLE IF NOT EXISTS nostr_key_vault (
            near_account TEXT PRIMARY KEY,
            ciphertext   TEXT NOT NULL,
            fingerprint  TEXT NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `),
      catch: () => new Error("vault: migration failed"),
    }).pipe(
      Effect.catch(() =>
        Effect.logWarning("[Vault] migration failed — vault disabled until DB is reachable"),
      ),
      Effect.orDie,
    );

    const store = (nearAccount: string, nsec: string) =>
      Effect.tryPromise({
        try: async () => {
          const ciphertext = encryptNsec(secret, nsec);
          const fp = nsecFingerprint(nsec);
          const res = await pool.query(
            `INSERT INTO nostr_key_vault (near_account, ciphertext, fingerprint, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (near_account)
             DO UPDATE SET ciphertext = EXCLUDED.ciphertext,
                           fingerprint = EXCLUDED.fingerprint,
                           updated_at = now()
             RETURNING created_at`,
            [nearAccount, ciphertext, fp],
          );
          return { createdAt: new Date(res.rows[0].created_at as string).toISOString() };
        },
        catch: () => new Error("vault: store failed"),
      });

    const load = (nearAccount: string) =>
      Effect.tryPromise({
        try: async () => {
          const res = await pool.query(
            `SELECT ciphertext, created_at FROM nostr_key_vault WHERE near_account = $1`,
            [nearAccount],
          );
          if (res.rows.length === 0) return null;
          const row = res.rows[0];
          return {
            nsec: decryptNsec(secret, row.ciphertext as string),
            createdAt: new Date(row.created_at as string).toISOString(),
          };
        },
        catch: () => new Error("vault: load failed"),
      });

    const remove = (nearAccount: string) =>
      Effect.tryPromise({
        try: async () => {
          const res = await pool.query(`DELETE FROM nostr_key_vault WHERE near_account = $1`, [
            nearAccount,
          ]);
          return (res.rowCount ?? 0) > 0;
        },
        catch: () => new Error("vault: remove failed"),
      });

    yield* Effect.logInfo("[Vault] nsec vault ready (AES-256-GCM at rest)");

    return { store, load, remove };
  }),
);
