import { describe, expect, it } from "vitest";
import { decryptNsec, encryptNsec, nsecFingerprint } from "../src/services/vault";

const SECRET = "unit-test-secret-with-at-least-32-chars!!";
const NSEC = "nsec1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursl6edet";

describe("vault crypto", () => {
  it("round-trips nsec through AES-256-GCM", () => {
    const blob = encryptNsec(SECRET, NSEC);
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain(NSEC);
    expect(decryptNsec(SECRET, blob)).toBe(NSEC);
  });

  it("produces unique ciphertexts (random IV)", () => {
    const a = encryptNsec(SECRET, NSEC);
    const b = encryptNsec(SECRET, NSEC);
    expect(a).not.toBe(b);
    expect(decryptNsec(SECRET, a)).toBe(decryptNsec(SECRET, b));
  });

  it("fails with the wrong key (GCM auth)", () => {
    const blob = encryptNsec(SECRET, NSEC);
    expect(() => decryptNsec("wrong-key-wrong-key-wrong-key!", blob)).toThrow();
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptNsec(SECRET, "v1:not-valid")).toThrow();
    expect(() => decryptNsec(SECRET, "v2:a:b:c")).toThrow("malformed");
  });

  it("fingerprints are stable and short", () => {
    expect(nsecFingerprint(NSEC)).toBe(nsecFingerprint(NSEC));
    expect(nsecFingerprint(NSEC)).toHaveLength(16);
    expect(nsecFingerprint(NSEC)).not.toContain(NSEC.slice(0, 8));
  });
});
