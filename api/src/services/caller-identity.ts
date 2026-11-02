/**
 * The caller as an owner of app data (#103). `ownerId` is the canonical owner id written on
 * new rows: the primary NEAR account, or the auth user id for a caller without one. `ids` is
 * every identifier the caller may have written rows under before (primary account, each
 * linked account, user id), so reads and deletes still find rows written before a primary
 * switch, a NEAR link, or a reissued user id.
 */
export type CallerIdentity = {
  ownerId: string;
  ids: string[];
  userId: string | null;
};

export function callerIdentity(context: {
  userId?: string | null;
  near?: {
    primaryAccountId?: string | null;
    linkedAccounts?: Array<{ accountId?: string | null }> | null;
  } | null;
}): CallerIdentity | null {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  add(context.near?.primaryAccountId?.trim().toLowerCase());
  for (const account of context.near?.linkedAccounts ?? []) {
    add(account.accountId?.trim().toLowerCase());
  }
  add(context.userId);
  const ownerId = ids[0];
  if (!ownerId) return null;
  return { ownerId, ids, userId: context.userId ?? null };
}
