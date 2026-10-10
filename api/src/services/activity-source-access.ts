import { ORPCError } from "every-plugin/orpc";

type ApprovalStatus = "pending" | "approved" | "rejected";

export function requireSourceNotRejected(source: { approvalStatus: ApprovalStatus }): void {
  if (source.approvalStatus === "rejected") {
    throw new ORPCError("FORBIDDEN", { message: "Activity Source was rejected" });
  }
}

export function requireAvailableSource<T extends { source: { approvalStatus: ApprovalStatus } }>(
  result: T | undefined,
  purpose: "ingestion" | "signing",
): asserts result is T {
  if (!result || result.source.approvalStatus === "rejected") {
    throw new ORPCError("FORBIDDEN", {
      message: `Activity Source is not available for ${purpose}`,
    });
  }
}
