// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityApiKeysPanel,
  ActivitySigningKeyPanel,
  shortenKey,
} from "@/components/activity-source-credentials";
import type {
  ActivitySigningIdentityView,
  ActivitySourceApiKeyView,
} from "@/components/activity-sources-model";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const boundIdentity: ActivitySigningIdentityView = {
  publicKey: "a".repeat(64),
  bindingStatus: "bound",
  boundNearAccountId: "feedback.near",
  boundAt: "2026-09-25T08:32:44.000Z",
  keyVersion: "v1",
  createdBy: "owner",
  createdAt: "2026-09-25T08:30:00.000Z",
  retiredBy: null,
  retirementReason: null,
  retiredAt: null,
};

const activeKey: ActivitySourceApiKeyView = {
  id: "key-1",
  sourceId: "feedback",
  name: "Production",
  prefix: "act_Uw9Het6B",
  permissions: ["event:write"],
  createdAt: "2026-09-25T09:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

describe("ActivitySigningKeyPanel", () => {
  it("shows the link action until the key is linked on-chain", () => {
    render(
      <ActivitySigningKeyPanel
        nearAccountId="feedback.near"
        identity={{ ...boundIdentity, bindingStatus: "pending" }}
        isRotating={false}
        onRotate={vi.fn()}
        linkAction={<button type="button">Approve in wallet</button>}
      />,
    );

    expect(screen.getByText("Not linked on-chain yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve in wallet" })).toBeTruthy();
  });

  it("summarises a linked key in plain terms and offers rotation", () => {
    const onRotate = vi.fn();
    render(
      <ActivitySigningKeyPanel
        nearAccountId="feedback.near"
        identity={boundIdentity}
        isRotating={false}
        onRotate={onRotate}
        linkAction={null}
      />,
    );

    expect(screen.getByText("Linked on-chain to feedback.near")).toBeTruthy();
    expect(screen.getByText(shortenKey(boundIdentity.publicKey))).toBeTruthy();
    expect(screen.queryByText(/Master key/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    expect(onRotate).toHaveBeenCalled();
  });
});

describe("ActivityApiKeysPanel", () => {
  it("asks for the on-chain link before offering keys", () => {
    render(
      <ActivityApiKeysPanel
        apiKeys={[]}
        isLinked={false}
        revealedApiKey={null}
        isSubmitting={false}
        onCreateApiKey={vi.fn()}
        onRevokeApiKey={vi.fn()}
        onDismissReveal={vi.fn()}
      />,
    );

    expect(screen.getByText(/Link the signing key on-chain first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create key" })).toBeNull();
  });

  it("lists active keys with safe metadata and hides revoked ones", () => {
    const onRevoke = vi.fn();
    render(
      <ActivityApiKeysPanel
        apiKeys={[activeKey, { ...activeKey, id: "key-2", revokedAt: "2026-09-26T00:00:00.000Z" }]}
        isLinked
        revealedApiKey={null}
        isSubmitting={false}
        onCreateApiKey={vi.fn()}
        onRevokeApiKey={onRevoke}
        onDismissReveal={vi.fn()}
      />,
    );

    expect(screen.getByText("act_Uw9Het6B…")).toBeTruthy();
    expect(screen.getByText(/Created Sep 25, 2026 · Never used/)).toBeTruthy();
    expect(screen.getByText("1 revoked key hidden.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Production" }));
    expect(onRevoke).toHaveBeenCalledWith("key-1");
  });

  it("creates a named key and reveals the secret once", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ActivityApiKeysPanel
        apiKeys={[]}
        isLinked
        revealedApiKey={null}
        isSubmitting={false}
        onCreateApiKey={onCreate}
        onRevokeApiKey={vi.fn()}
        onDismissReveal={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New key name"), { target: { value: "Staging" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Staging"));

    rerender(
      <ActivityApiKeysPanel
        apiKeys={[activeKey]}
        isLinked
        revealedApiKey={{ secret: "act_secret", apiKeyId: "key-1" }}
        isSubmitting={false}
        onCreateApiKey={onCreate}
        onRevokeApiKey={vi.fn()}
        onDismissReveal={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("New API key") as HTMLInputElement).value).toBe("act_secret");
  });
});
