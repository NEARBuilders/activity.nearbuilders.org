import { describe, expect, it } from "vitest";
import { resolveActivityRelayUrl } from "@/activity/activity-config";

describe("resolveActivityRelayUrl", () => {
  it("prefers a non-empty runtime override", () => {
    expect(resolveActivityRelayUrl("wss://relay.nearbuilders.org", "  ws://127.0.0.1:7447  ")).toBe(
      "ws://127.0.0.1:7447",
    );
  });

  it.each([
    undefined,
    "",
    "   ",
  ])("falls back to the configured relay for override %j", (override) => {
    expect(resolveActivityRelayUrl("wss://relay.nearbuilders.org", override)).toBe(
      "wss://relay.nearbuilders.org",
    );
  });
});
