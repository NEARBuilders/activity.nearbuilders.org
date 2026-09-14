import { describe, expect, it } from "vitest";
import { assertMasterKeysConfigured } from "@/activity/activity-credentials-crypto";

describe("assertMasterKeysConfigured", () => {
  it("returns without throwing when a non-empty keyring is supplied", () => {
    expect(() =>
      assertMasterKeysConfigured(
        '{"v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}',
        "production",
      ),
    ).not.toThrow();
  });

  it.each([
    "",
    "   ",
    "\n\t",
  ])("throws a production-specific hint when ACTIVITY_SIGNING_MASTER_KEYS is %j in production", (raw) => {
    expect(() => assertMasterKeysConfigured(raw, "production")).toThrow(
      /ACTIVITY_SIGNING_MASTER_KEYS is empty.*bun run keys:gen/s,
    );
  });

  it.each([
    "development",
    "test",
    undefined,
    "staging",
  ])("throws a development hint when ACTIVITY_SIGNING_MASTER_KEYS is empty in %s", (nodeEnv) => {
    expect(() => assertMasterKeysConfigured("", nodeEnv)).toThrow(
      /ACTIVITY_SIGNING_MASTER_KEYS is empty.*dev fallback supplied by api\/plugin\.dev\.ts/s,
    );
  });
});
