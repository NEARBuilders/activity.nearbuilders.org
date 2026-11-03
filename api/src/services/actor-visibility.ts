import type { z } from "zod";
import type { ActivitySourceSchema, HideActivityEventResult } from "../contract";
import type { ActivitySourceRecord } from "./activity-sources";

/**
 * Who may see which administrator acted (#117). Audit columns record an administrator by their
 * NEAR account, so only platform administrators receive those ids. Organization members still
 * see every decision, reason and timestamp, just not who made it.
 */
export function isPlatformAdministrator(context: { user?: { role?: string | null } | null }) {
  return context.user?.role === "admin";
}

export type ActivitySourceView = z.infer<typeof ActivitySourceSchema>;

/** Strips administrator ids from a source for a caller who is not a platform administrator. */
export function withoutAdministratorIds(source: ActivitySourceRecord): ActivitySourceView {
  const { reviewedBy: _reviewedBy, reviewHistory, trustHistory, ...rest } = source;
  return {
    ...rest,
    reviewHistory: reviewHistory.map(({ administratorId: _id, ...review }) => review),
    trustHistory: trustHistory.map(({ administratorId: _id, ...change }) => change),
  };
}

export function sourceForCaller(
  source: ActivitySourceRecord,
  context: { user?: { role?: string | null } | null },
): ActivitySourceView {
  return isPlatformAdministrator(context) ? source : withoutAdministratorIds(source);
}

/**
 * Strips requester ids other than the source's own from a retraction result: a source sees its
 * own "source:<id>" requester id, never the id of an administrator who also hid the event. The
 * requests themselves (reason, time, applied) stay visible, as before.
 */
export function retractionForSource(
  result: HideActivityEventResult,
  requesterId: string,
): HideActivityEventResult {
  const { hiddenBy, moderationHistory, ...hiddenEvent } = result.hiddenEvent;
  return {
    ...result,
    hiddenEvent: {
      ...hiddenEvent,
      ...(hiddenBy === requesterId ? { hiddenBy } : {}),
      moderationHistory: moderationHistory.map(({ administratorId, ...request }) =>
        administratorId === requesterId ? { ...request, administratorId } : request,
      ),
    },
  };
}
