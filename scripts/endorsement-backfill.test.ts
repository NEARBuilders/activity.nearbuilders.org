import { describe, expect, it } from "vitest";
import { type EndorsementRow, planEndorsementBackfill } from "./lib/endorsement-backfill";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute));
const row = (
  id: string,
  eventId: string,
  userId: string | null,
  owner: string | null,
  minute = 0,
) =>
  ({ id, eventId, userId, ownerAccountId: owner, createdAt: at(minute) }) satisfies EndorsementRow;

const links = [
  { userId: "u-alice", accountId: "Alice.near", isPrimary: true },
  { userId: "u-alice", accountId: "alice-alt.near", isPrimary: false },
  { userId: "u-bob", accountId: "bob.near", isPrimary: true },
];

describe("planEndorsementBackfill (#103)", () => {
  it("keys legacy rows on the primary account, or the user id without NEAR", () => {
    const plan = planEndorsementBackfill(
      [row("1", "e1", "u-alice", null), row("2", "e1", "u-carol", null)],
      links,
    );
    expect(plan.updates).toEqual([
      { id: "1", ownerAccountId: "alice.near" },
      { id: "2", ownerAccountId: "u-carol" },
    ]);
    expect(plan.deletes).toEqual([]);
    expect(plan.usersWithoutNear).toBe(1);
  });

  it("re-keys rows written under the user id before the user linked NEAR", () => {
    const plan = planEndorsementBackfill([row("1", "e1", "u-bob", "u-bob")], links);
    expect(plan.updates).toEqual([{ id: "1", ownerAccountId: "bob.near" }]);
  });

  it("merges rows that collapse onto one owner, keeping the oldest", () => {
    const plan = planEndorsementBackfill(
      [row("new", "e1", "u-alice", "alice.near", 5), row("old", "e1", "u-alice", null, 1)],
      links,
    );
    expect(plan.deletes).toEqual(["new"]);
    expect(plan.updates).toEqual([{ id: "old", ownerAccountId: "alice.near" }]);
  });

  it("leaves rows already keyed on a NEAR account alone", () => {
    const plan = planEndorsementBackfill(
      [row("1", "e1", "u-alice", "alice-alt.near"), row("2", "e2", null, "bob.near")],
      links,
    );
    expect(plan).toEqual({ updates: [], deletes: [], usersWithoutNear: 0 });
  });
});
