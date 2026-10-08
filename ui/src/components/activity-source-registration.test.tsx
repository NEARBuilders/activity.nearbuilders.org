// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";

afterEach(cleanup);

describe("ActivitySourceRegistration", () => {
  it("renders the supplied action alongside a blocker so the page is never a dead end", () => {
    render(
      <ActivitySourceRegistration
        access="organization-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        registrationAction={<button type="button">Create an organization</button>}
      />,
    );

    expect(screen.getByText("Select an active organization")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create an organization" })).toBeTruthy();
  });

  it("explains that a NEAR account signs an on-chain transaction", () => {
    render(
      <ActivitySourceRegistration
        access="near-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        registrationAction={<button type="button">Connect NEAR wallet</button>}
      />,
    );

    expect(screen.getByText(/one on-chain transaction/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect NEAR wallet" })).toBeTruthy();
  });

  it("tells an owner that members cannot register sources", () => {
    render(
      <ActivitySourceRegistration
        access="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/Members cannot register sources/)).toBeTruthy();
  });

  it("documents the permanent fields and the meaning of a zero point value", () => {
    render(<ActivitySourceRegistration access="allowed" isSubmitting={false} onCreate={vi.fn()} />);

    expect(screen.getByText(/It cannot be changed later/)).toBeTruthy();
    expect(screen.getByText(/Each NEAR account can own only one source/)).toBeTruthy();
    expect(screen.getByText(/0 scores nothing/)).toBeTruthy();
    expect(screen.getByText(/rejected with a 400/)).toBeTruthy();
  });

  it("flags an invalid Source ID as it is typed and blocks submission", () => {
    const onCreate = vi.fn();
    render(
      <ActivitySourceRegistration access="allowed" isSubmitting={false} onCreate={onCreate} />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "Near Catalog" } });

    expect(screen.getByRole("alert").textContent).toMatch(/lowercase letters and numbers/);
  });

  it("shows a conflict under the field it belongs to", async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new Error("The NEAR account catalog.near already owns an Activity Source"),
      );
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={onCreate}
        defaultNearAccountId="catalog.near"
      />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "near-catalog" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NEAR Catalog" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "catalog.published" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Published" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Register source" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The NEAR account catalog.near already owns an Activity Source",
      ),
    );
  });

  it("fills the form from a pasted nearbuilders.org project link", async () => {
    const onCreate = vi.fn();
    const onImportProject = vi.fn().mockResolvedValue({
      project: {
        id: "proj_1791152600182_r4z661r",
        title: "activity.nearbuilders.org",
        url: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
      },
      sourceId: "activity.nearbuilders.org",
      displayName: "activity.nearbuilders.org",
      nearAccountId: "nearbuilding.near",
    });
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={onCreate}
        onImportProject={onImportProject}
      />,
    );

    fireEvent.change(screen.getByLabelText("Import from nearbuilders.org"), {
      target: { value: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill from project" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Source ID") as HTMLInputElement).value).toBe(
        "activity.nearbuilders.org",
      ),
    );
    expect(onImportProject).toHaveBeenCalledWith(
      "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
    );
    expect((screen.getByLabelText("NEAR account") as HTMLInputElement).value).toBe(
      "nearbuilding.near",
    );
    expect(screen.getByRole("link", { name: "activity.nearbuilders.org" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "project.updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: "activity.nearbuilders.org",
          nearbuildersProjectId: "proj_1791152600182_r4z661r",
        }),
      ),
    );
  });

  it("shows why a pasted project could not be imported", async () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onImportProject={vi
          .fn()
          .mockRejectedValue(new Error('No nearbuilders.org project matches "missing"'))}
      />,
    );

    fireEvent.change(screen.getByLabelText("Import from nearbuilders.org"), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill from project" }));

    expect(await screen.findByText('No nearbuilders.org project matches "missing"')).toBeTruthy();
  });

  it("registers an event type without a description", async () => {
    const onCreate = vi.fn();
    render(
      <ActivitySourceRegistration access="allowed" isSubmitting={false} onCreate={onCreate} />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "near-catalog" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NEAR Catalog" } });
    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "catalog.near" } });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "catalog.project.published" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventTypes: [
            expect.objectContaining({ name: "catalog.project.published", description: "" }),
          ],
        }),
      ),
    );
  });

  it("edits a registered source without changing its Source ID", async () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    render(
      <ActivitySourceRegistration
        access="allowed"
        mode="edit"
        isSubmitting={false}
        onCreate={onCreate}
        onCancel={onCancel}
        onImportProject={vi.fn()}
        defaults={{
          sourceId: "near-catalog",
          displayName: "NEAR Catalog",
          nearAccountId: "catalog.near",
          eventTypes: [
            { name: "catalog.published", description: "", enabled: true, pointValue: 1 },
          ],
        }}
      />,
    );

    expect((screen.getByLabelText("Source ID") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByLabelText("Import from nearbuilders.org")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Catalog" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "near-catalog", displayName: "Catalog" }),
      ),
    );
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Catalog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
