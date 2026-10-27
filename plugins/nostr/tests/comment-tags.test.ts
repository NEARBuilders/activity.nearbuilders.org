import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { nearTargetKey } from "../src/nostr-core/types";
import { assertCommentTagsMatchRequest } from "../src/services/nostr";

function makeEvent(tags: string[][], content: string) {
  return finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    generateSecretKey(),
  );
}

describe("nearTargetKey", () => {
  it("composites targetType and target with a colon", () => {
    expect(nearTargetKey("project", "test-nostr-page")).toBe("project:test-nostr-page");
    expect(nearTargetKey("builder", "alice.near")).toBe("builder:alice.near");
  });
});

describe("assertCommentTagsMatchRequest", () => {
  it("accepts an event whose near_target tag matches the request composite", () => {
    const event = makeEvent([["near_target", "project:test-nostr-page"]], "hello");
    expect(assertCommentTagsMatchRequest(event, "test-nostr-page", "project")).toBeNull();
  });

  it("accepts an event whose near_target matches with extra tags alongside", () => {
    const event = makeEvent(
      [
        ["t", "project"],
        ["t", "nostr.nearbuilders.org"],
        ["near_target", "project:test-nostr-page"],
        ["near_account", "alice.near"],
      ],
      "hello",
    );
    expect(assertCommentTagsMatchRequest(event, "test-nostr-page", "project")).toBeNull();
  });

  it("rejects an event missing the near_target tag", () => {
    const event = makeEvent([["t", "project"]], "hello");
    const err = assertCommentTagsMatchRequest(event, "test-nostr-page", "project");
    expect(err).not.toBeNull();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(String((err as Error).message)).toMatch(/missing the required 'near_target' tag/);
  });

  it("rejects an event whose near_target raw value differs from the composite", () => {
    const event = makeEvent([["near_target", "test-nostr-page"]], "hello");
    const err = assertCommentTagsMatchRequest(event, "test-nostr-page", "project");
    expect(err).not.toBeNull();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(String((err as Error).message)).toMatch(/does not match the request/);
  });

  it("rejects an event whose near_target uses the wrong targetType", () => {
    const event = makeEvent([["near_target", "builder:test-nostr-page"]], "hello");
    const err = assertCommentTagsMatchRequest(event, "test-nostr-page", "project");
    expect(err).not.toBeNull();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when the request target is different from the signed target", () => {
    const event = makeEvent([["near_target", "project:other-page"]], "hello");
    const err = assertCommentTagsMatchRequest(event, "test-nostr-page", "project");
    expect(err).not.toBeNull();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
  });
});
