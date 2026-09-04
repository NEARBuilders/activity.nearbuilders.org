// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivitySourcesDashboard,
  type ActivitySourceView,
} from "@/components/activity-sources-dashboard";

afterEach(cleanup);

const pendingSource: ActivitySourceView = {
  sourceId: "near-catalog",
  displayName: "NEAR Catalog",
  nearAccountId: "catalog.near",
  organizationId: "org-1",
  approvalStatus: "pending",
  canIngest: false,
  trustStatus: "standard",
  scoreMultiplier: 1,
  eventTypes: [
    {
      name: "catalog.project.published",
      description: "A project was published",
      enabled: true,
      pointValue: 25,
    },
  ],
  reviewHistory: [],
  trustHistory: [],
  reviewedBy: null,
  reviewReason: null,
  reviewedAt: null,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

describe("ActivitySourcesDashboard", () => {
  it("shows source registration and the owning organization's configuration", () => {
    const markup = renderToStaticMarkup(
      <ActivitySourcesDashboard
        sources={[pendingSource]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    expect(markup).toContain("Register Activity Source");
    expect(markup).toContain("NEAR Catalog");
    expect(markup).toContain("catalog.project.published");
    expect(markup).toContain("25 points");
    expect(markup).toContain("Pending approval");
    expect(markup).toContain("Standard weighting");
    expect(markup).not.toContain("Approve source");
  });

  it("shows the source review queue to platform administrators", () => {
    const markup = renderToStaticMarkup(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[pendingSource]}
        adminSources={[pendingSource]}
        isAdmin
        registrationAccess="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    expect(markup).toContain("Source review queue");
    expect(markup).toContain("Approve source");
    expect(markup).toContain("Reject source");
  });

  it("asks for an active organization instead of showing an unusable registration form", () => {
    const markup = renderToStaticMarkup(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="organization-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    expect(markup).toContain("Select an active organization");
    expect(markup).not.toContain("Register source");
  });

  it("explains when the active member is not an organization owner", () => {
    const markup = renderToStaticMarkup(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    expect(markup).toContain("Organization owner required");
  });

  it("explains when the owner has not authenticated with NEAR", () => {
    const markup = renderToStaticMarkup(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="near-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    expect(markup).toContain("Connect a NEAR account");
  });

  it("submits the declared source and event type", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="allowed"
        isSubmitting={false}
        onCreate={onCreate}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "near-catalog" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NEAR Catalog" } });
    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "catalog.near" } });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "catalog.project.published" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A project was published" },
    });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        sourceId: "near-catalog",
        displayName: "NEAR Catalog",
        nearAccountId: "catalog.near",
        eventTypes: [
          {
            name: "catalog.project.published",
            description: "A project was published",
            enabled: true,
            pointValue: 25,
          },
        ],
      });
    });
    expect((screen.getByLabelText("Source ID") as HTMLInputElement).value).toBe("");
  });

  it("preserves registration input when creation fails", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("Registration failed"));
    render(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[]}
        isAdmin={false}
        registrationAccess="allowed"
        isSubmitting={false}
        onCreate={onCreate}
        onReview={vi.fn()}
        onTrust={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "near-catalog" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NEAR Catalog" } });
    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "catalog.near" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "catalog.updated" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect((screen.getByLabelText("Source ID") as HTMLInputElement).value).toBe("near-catalog");
  });

  it("submits an auditable administrator decision", async () => {
    const onReview = vi.fn().mockResolvedValue(undefined);
    render(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[pendingSource]}
        adminSources={[pendingSource]}
        isAdmin
        registrationAccess="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={onReview}
        onTrust={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Auditable review reason"), {
      target: { value: "Verified repository ownership" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve source" }));

    await waitFor(() => {
      expect(onReview).toHaveBeenCalledWith({
        sourceId: "near-catalog",
        decision: "approved",
        reason: "Verified repository ownership",
      });
    });
  });

  it("lets an administrator configure trust weighting with an auditable reason", async () => {
    const onTrust = vi.fn().mockResolvedValue(undefined);
    render(
      <ActivitySourcesDashboard
        sources={[]}
        reviewQueue={[]}
        adminSources={[pendingSource]}
        isAdmin
        registrationAccess="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        onReview={vi.fn()}
        onTrust={onTrust}
      />,
    );

    fireEvent.change(screen.getByLabelText("Trust designation for near-catalog"), {
      target: { value: "trusted" },
    });
    fireEvent.change(screen.getByLabelText("Score multiplier for near-catalog"), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText("Auditable trust reason for near-catalog"), {
      target: { value: "Established source with reviewed operating history" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save trust for near-catalog" }));

    await waitFor(() => {
      expect(onTrust).toHaveBeenCalledWith({
        sourceId: "near-catalog",
        trustStatus: "trusted",
        scoreMultiplier: 1.5,
        reason: "Established source with reviewed operating history",
      });
    });
  });
});
