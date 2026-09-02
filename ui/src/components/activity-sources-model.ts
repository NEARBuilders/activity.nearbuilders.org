export interface ActivityEventTypeView {
  name: string;
  description: string;
  enabled: boolean;
  pointValue: number;
}

export interface ActivitySourceView {
  sourceId: string;
  displayName: string;
  nearAccountId: string;
  organizationId: string;
  approvalStatus: "pending" | "approved" | "rejected";
  canIngest: boolean;
  eventTypes: ActivityEventTypeView[];
  reviewHistory: Array<{
    decision: "approved" | "rejected";
    reason: string;
    administratorId: string;
    reviewedAt: string;
  }>;
  reviewedBy: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActivitySourceInput {
  sourceId: string;
  displayName: string;
  nearAccountId: string;
  eventTypes: ActivityEventTypeView[];
}

export interface ReviewActivitySourceInput {
  sourceId: string;
  decision: "approved" | "rejected";
  reason: string;
}

export interface ActivitySigningIdentityView {
  publicKey: string;
  bindingStatus: "pending" | "bound";
  boundNearAccountId: string | null;
  boundAt: string | null;
  keyVersion: string;
  createdAt: string;
  retiredAt: string | null;
}

export interface ActivitySourceApiKeyView {
  id: string;
  sourceId: string;
  name: string;
  prefix: string;
  permissions: ["event:write"];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
