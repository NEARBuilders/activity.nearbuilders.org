export type EndorsementRow = {
  id: string;
  eventId: string;
  userId: string | null;
  ownerAccountId: string | null;
  createdAt: Date;
};

export type NearLink = {
  userId: string;
  accountId: string;
  isPrimary: boolean;
};

export type EndorsementBackfillPlan = {
  updates: Array<{ id: string; ownerAccountId: string }>;
  deletes: string[];
  usersWithoutNear: number;
};

/**
 * Plans the #103 backfill: every endorsement that isn't keyed on its endorser's canonical
 * owner id yet (rows from before `owner_account_id`, or keyed on the user id from before
 * the user linked NEAR) moves to the primary NEAR account, or the user id for a user with
 * none. When that collapses two rows for one event onto one owner, the oldest is kept.
 */
export function planEndorsementBackfill(
  rows: readonly EndorsementRow[],
  links: readonly NearLink[],
): EndorsementBackfillPlan {
  const primaryByUser = new Map<string, string>();
  for (const link of links) {
    if (link.isPrimary) primaryByUser.set(link.userId, link.accountId.trim().toLowerCase());
  }

  const usersWithoutNear = new Set<string>();
  const targetOf = (row: EndorsementRow): string | null => {
    if (!row.userId) return row.ownerAccountId;
    const keyedOnUser = row.ownerAccountId === null || row.ownerAccountId === row.userId;
    if (!keyedOnUser) return row.ownerAccountId;
    const primary = primaryByUser.get(row.userId);
    if (!primary) usersWithoutNear.add(row.userId);
    return primary ?? row.userId;
  };

  const byOwnerAndEvent = new Map<string, EndorsementRow[]>();
  const targets = new Map<string, string>();
  for (const row of rows) {
    const target = targetOf(row);
    if (!target) continue;
    targets.set(row.id, target);
    const key = `${row.eventId}\u0000${target}`;
    byOwnerAndEvent.set(key, [...(byOwnerAndEvent.get(key) ?? []), row]);
  }

  const updates: EndorsementBackfillPlan["updates"] = [];
  const deletes: string[] = [];
  for (const group of byOwnerAndEvent.values()) {
    const [kept, ...duplicates] = [...group].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    if (!kept) continue;
    deletes.push(...duplicates.map(({ id }) => id));
    const target = targets.get(kept.id)!;
    if (kept.ownerAccountId !== target) updates.push({ id: kept.id, ownerAccountId: target });
  }

  return { updates, deletes, usersWithoutNear: usersWithoutNear.size };
}
