export type ActivityOnboardingStepId =
  | "near"
  | "organization"
  | "register"
  | "approval"
  | "binding"
  | "api-key";

export type ActivityOnboardingStepStatus =
  | "complete"
  | "current"
  | "waiting"
  | "blocked"
  | "upcoming";

export interface ActivityOnboardingStep {
  id: ActivityOnboardingStepId;
  status: ActivityOnboardingStepStatus;
}

type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ActivityOnboardingInput {
  hasNearAccount: boolean;
  isOrganizationOwner: boolean;
  source: { approvalStatus: ApprovalStatus } | null;
  identity: { bindingStatus: "pending" | "bound" } | null;
  hasApiKey: boolean;
}

const approvalPreference: ApprovalStatus[] = ["approved", "pending", "rejected"];

export function pickOnboardingSource<T extends { approvalStatus: ApprovalStatus }>(
  sources: T[],
): T | null {
  for (const status of approvalPreference) {
    const match = sources.find((source) => source.approvalStatus === status);
    if (match) return match;
  }
  return null;
}

export function getActivityOnboardingSteps(
  input: ActivityOnboardingInput,
): ActivityOnboardingStep[] {
  const done: Array<[ActivityOnboardingStepId, boolean]> = [
    ["near", input.hasNearAccount],
    ["organization", input.isOrganizationOwner],
    ["register", input.source !== null],
    ["approval", input.source?.approvalStatus === "approved"],
    ["binding", input.identity?.bindingStatus === "bound"],
    ["api-key", input.hasApiKey],
  ];
  const currentIndex = done.findIndex(([, isDone]) => !isDone);

  return done.map(([id, isDone], index) => {
    if (isDone) return { id, status: "complete" };
    if (index !== currentIndex) return { id, status: "upcoming" };
    if (id === "approval" && input.source?.approvalStatus === "pending") {
      return { id, status: "waiting" };
    }
    if (id === "approval" && input.source?.approvalStatus === "rejected") {
      return { id, status: "blocked" };
    }
    return { id, status: "current" };
  });
}
