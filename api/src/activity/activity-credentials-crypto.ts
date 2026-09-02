import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export interface ActivityMasterKeys {
  activeVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
}

export function parseActivityMasterKeys(
  serialized: string,
  activeVersion: string,
): ActivityMasterKeys {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Activity signing master keys must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Activity signing master keys must be a JSON object");
  }

  const keys = new Map<string, Uint8Array>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (typeof encoded !== "string") {
      throw new Error(`Activity signing master key ${version} must be base64 encoded`);
    }
    const key = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (key.length !== 32) {
      throw new Error(`Activity signing master key ${version} must decode to 32 bytes`);
    }
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) {
    throw new Error("Active Activity signing master key version is not configured");
  }
  return { activeVersion, keys };
}

export function encryptActivitySecret(
  plaintext: Uint8Array,
  masterKeys: ActivityMasterKeys,
): EncryptedSecret {
  const key = masterKeys.keys.get(masterKeys.activeVersion);
  if (!key) throw new Error("Active Activity signing master key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: masterKeys.activeVersion,
  };
}

export function decryptActivitySecret(
  encrypted: EncryptedSecret,
  masterKeys: ActivityMasterKeys,
): Uint8Array {
  const key = masterKeys.keys.get(encrypted.keyVersion);
  if (!key) throw new Error("Activity signing master key version is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Uint8Array.from(
    Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]),
  );
}
