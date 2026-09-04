// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySourceCredentials } from "@/components/activity-source-credentials";

afterEach(cleanup);

describe("ActivitySourceCredentials", () => {
  it("walks an approved source owner through identity, binding, and API-key controls", async () => {
    const onCreateIdentity = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ActivitySourceCredentials
        sourceId="feedback"
        nearAccountId="feedback.near"
        identity={null}
        apiKeys={[]}
        isSubmitting={false}
        onCreateIdentity={onCreateIdentity}
        onBind={vi.fn()}
        onConfirmBinding={vi.fn()}
        onRotate={vi.fn()}
        onCreateApiKey={vi.fn()}
        onRevokeApiKey={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Signing Identity" }));
    await waitFor(() => expect(onCreateIdentity).toHaveBeenCalledOnce());

    const onBind = vi.fn().mockResolvedValue(undefined);
    const onConfirmBinding = vi.fn().mockResolvedValue(undefined);
    rerender(
      <ActivitySourceCredentials
        sourceId="feedback"
        nearAccountId="feedback.near"
        identity={{
          publicKey: "a".repeat(64),
          bindingStatus: "pending",
          boundNearAccountId: null,
          boundAt: null,
          keyVersion: "v1",
          createdBy: "owner-1",
          createdAt: "2026-09-03T00:00:00.000Z",
          retiredBy: null,
          retirementReason: null,
          retiredAt: null,
        }}
        apiKeys={[]}
        isSubmitting={false}
        onCreateIdentity={onCreateIdentity}
        onBind={onBind}
        onConfirmBinding={onConfirmBinding}
        onRotate={vi.fn()}
        onCreateApiKey={vi.fn()}
        onRevokeApiKey={vi.fn()}
      />,
    );

    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    expect(screen.getByText(/Connect feedback\.near, authorize the binding/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorize with NEAR" }));
    fireEvent.click(screen.getByRole("button", { name: "Check binding" }));
    await waitFor(() => {
      expect(onBind).toHaveBeenCalledOnce();
      expect(onConfirmBinding).toHaveBeenCalledOnce();
    });
    expect(screen.queryByLabelText("Source API Key name")).toBeNull();
  });

  it("reveals a newly created key while listing only safe key metadata", async () => {
    const onCreateApiKey = vi.fn().mockResolvedValue(undefined);
    const onRevokeApiKey = vi.fn().mockResolvedValue(undefined);
    render(
      <ActivitySourceCredentials
        sourceId="feedback"
        nearAccountId="feedback.near"
        identity={{
          publicKey: "b".repeat(64),
          bindingStatus: "bound",
          boundNearAccountId: "feedback.near",
          boundAt: "2026-09-03T00:00:00.000Z",
          keyVersion: "v1",
          createdBy: "owner-1",
          createdAt: "2026-09-03T00:00:00.000Z",
          retiredBy: null,
          retirementReason: null,
          retiredAt: null,
        }}
        apiKeys={[
          {
            id: "key-1",
            sourceId: "feedback",
            name: "Production",
            prefix: "act_abcdefgh",
            permissions: ["event:write"],
            createdAt: "2026-09-03T00:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null,
          },
        ]}
        revealedApiKey={{
          secret: `act_${"x".repeat(43)}`,
          apiKeyId: "key-1",
        }}
        isSubmitting={false}
        onCreateIdentity={vi.fn()}
        onBind={vi.fn()}
        onConfirmBinding={vi.fn()}
        onRotate={vi.fn()}
        onCreateApiKey={onCreateApiKey}
        onRevokeApiKey={onRevokeApiKey}
      />,
    );

    expect(screen.getByDisplayValue(`act_${"x".repeat(43)}`)).toBeTruthy();
    expect(screen.getByText("act_abcdefgh")).toBeTruthy();
    expect(screen.getByText("event:write")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Source API Key name"), {
      target: { value: "Staging gateway" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Source API Key" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Production" }));

    await waitFor(() => {
      expect(onCreateApiKey).toHaveBeenCalledWith("Staging gateway");
      expect(onRevokeApiKey).toHaveBeenCalledWith("key-1");
    });
  });
});
