import { describe, expect, it } from "vitest";
import { NostrCommentSchema } from "../src/lib/schemas";
import { extractThreadIds } from "../src/services/nostr";

describe("extractThreadIds", () => {
  it("returns root and reply for a nested reply", () => {
    const tags = [
      ["e", "root-id", "", "root"],
      ["e", "parent-id", "", "reply"],
    ];

    expect(extractThreadIds(tags)).toEqual({ parentEventId: "parent-id", rootEventId: "root-id" });
  });

  it("falls back to the reply target as root for legacy single-tag replies", () => {
    const tags = [["e", "parent-id", "", "reply"]];

    expect(extractThreadIds(tags)).toEqual({
      parentEventId: "parent-id",
      rootEventId: "parent-id",
    });
  });

  it("returns undefined pointers for a top-level comment", () => {
    const tags = [
      ["t", "project"],
      ["near_target", "project:x"],
    ];

    expect(extractThreadIds(tags)).toEqual({ parentEventId: undefined, rootEventId: undefined });
  });
});

describe("NostrCommentSchema", () => {
  it("accepts a comment carrying rootEventId", () => {
    const parsed = NostrCommentSchema.parse({
      id: "id",
      pubkey: "pubkey",
      content: "hello",
      target: "x",
      targetType: "project",
      parentEventId: "parent-id",
      rootEventId: "root-id",
      createdAt: 1,
      source: "standard",
    });

    expect(parsed.rootEventId).toBe("root-id");
  });

  it("still accepts comments without thread pointers", () => {
    const parsed = NostrCommentSchema.parse({
      id: "id",
      pubkey: "pubkey",
      content: "hello",
      target: "x",
      targetType: "project",
      createdAt: 1,
      source: "standard",
    });

    expect(parsed.rootEventId).toBeUndefined();
  });
});
