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
    expect(screen.getByText(/One NEAR account can own up to 10 sources/)).toBeTruthy();
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

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
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

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
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
    expect(screen.queryByLabelText("Find your project on nearbuilders.org")).toBeNull();
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

  it("lists every matching project, marking and ranking the ones owned by any linked account first", async () => {
    const onSearchProjects = vi.fn().mockResolvedValue([
      {
        id: "proj_other",
        slug: "activity-clone-a1b2c3",
        title: "Activity Clone",
        url: "https://nearbuilders.org/projects/activity-clone-a1b2c3",
        ownerId: "someone.near",
      },
      {
        id: "proj_1791152600182_r4z661r",
        slug: "activity-nearbuilders-org-2erd1k",
        title: "activity.nearbuilders.org",
        url: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
        ownerId: "nearbuilding.near",
      },
    ]);
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
        onCreate={vi.fn()}
        defaultNearAccountId="other.near"
        ownedAccountIds={["other.near", "nearbuilding.near"]}
        onImportProject={onImportProject}
        onSearchProjects={onSearchProjects}
      />,
    );

    expect(screen.queryByRole("button", { name: "Fill from project" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
      target: { value: "activity" },
    });

    const results = await screen.findByRole("list", {
      name: "Matching nearbuilders.org projects",
    });
    expect(onSearchProjects).toHaveBeenCalledWith("activity");
    const options = results.querySelectorAll("button");
    expect(options[0]?.textContent).toContain("activity.nearbuilders.org");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("Owned");
    expect(options[1]?.textContent).toContain("Activity Clone");
    expect(options[1]?.textContent).not.toContain("Owned");

    fireEvent.click(options[0] as HTMLButtonElement);

    await waitFor(() =>
      expect((screen.getByLabelText("Source ID") as HTMLInputElement).value).toBe(
        "activity.nearbuilders.org",
      ),
    );
    expect(onImportProject).toHaveBeenCalledWith("proj_1791152600182_r4z661r");
    expect(screen.queryByRole("list", { name: "Matching nearbuilders.org projects" })).toBeNull();
  });

  it("tells the owner when no project matches the search", async () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onImportProject={vi.fn()}
        onSearchProjects={vi.fn().mockResolvedValue([])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText(/No projects match/)).toBeTruthy();
  });

  it("still fills from a pasted link when search is available", async () => {
    const onSearchProjects = vi.fn();
    const onImportProject = vi.fn().mockResolvedValue({
      project: { id: "proj_1", title: "Linked", url: "https://nearbuilders.org/projects/linked" },
      displayName: "Linked",
    });
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onImportProject={onImportProject}
        onSearchProjects={onSearchProjects}
      />,
    );

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
      target: { value: "https://nearbuilders.org/projects/linked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill from project" }));

    await waitFor(() =>
      expect(onImportProject).toHaveBeenCalledWith("https://nearbuilders.org/projects/linked"),
    );
    expect(onSearchProjects).not.toHaveBeenCalled();
  });

  it("asks for the project owner's account when importing a project the user does not own", async () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        defaultNearAccountId="saad.near"
        ownedAccountIds={["saad.near"]}
        onImportProject={vi.fn().mockResolvedValue({
          project: {
            id: "proj_owned_elsewhere",
            title: "Someone Else's App",
            url: "https://nearbuilders.org/projects/someone-elses-app",
          },
          displayName: "Someone Else's App",
          nearAccountId: "owner.near",
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
      target: { value: "https://nearbuilders.org/projects/someone-elses-app" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill from project" }));

    await waitFor(() =>
      expect((screen.getByLabelText("NEAR account") as HTMLInputElement).value).toBe("owner.near"),
    );
    expect(screen.getByText(/Sign in with the project owner's NEAR account:/)).toBeTruthy();
    expect(screen.getByText("owner.near")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "saad.near" } });
    expect(screen.queryByText(/Sign in with the project owner's NEAR account:/)).toBeNull();
  });

  it("does not ask for another account when the user owns the imported project", async () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        ownedAccountIds={["owner.near"]}
        onImportProject={vi.fn().mockResolvedValue({
          project: {
            id: "proj_mine",
            title: "My App",
            url: "https://nearbuilders.org/projects/my-app",
          },
          displayName: "My App",
          nearAccountId: "owner.near",
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Find your project on nearbuilders.org"), {
      target: { value: "https://nearbuilders.org/projects/my-app" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill from project" }));

    await waitFor(() =>
      expect((screen.getByLabelText("NEAR account") as HTMLInputElement).value).toBe("owner.near"),
    );
    expect(screen.queryByText(/Sign in with the project owner's NEAR account:/)).toBeNull();
  });

  it("keeps Register source disabled and says what is missing until the form is complete", () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        ownedAccountIds={["saad.near"]}
      />,
    );
    const submit = () =>
      screen.getByRole("button", { name: "Register source" }) as HTMLButtonElement;

    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Add a Source ID.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "saad-app" } });
    expect(screen.getByText("Add a display name.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Saad App" } });
    expect(screen.getByText("Add the NEAR account that will sign.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "someone.near" } });
    expect(screen.getByText("Sign in with someone.near to register this source.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("NEAR account"), { target: { value: "saad.near" } });
    expect(screen.getByText("Name every event type.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Task Done" } });
    expect(screen.getByText(/Use lowercase letters and numbers in event type names/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "task.done" } });
    expect(submit().disabled).toBe(false);
    expect(screen.queryByText(/Add a|Sign in with|Name every/)).toBeNull();
  });

  it("does not require a linked account when editing an existing source", () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        mode="edit"
        ownedAccountIds={["saad.near"]}
        defaults={{
          sourceId: "team-app",
          displayName: "Team App",
          nearAccountId: "teammate.near",
          eventTypes: [{ name: "task.done", description: "", enabled: true, pointValue: 1 }],
        }}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("starts with only the project search and an Enter manually option", () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onImportProject={vi.fn()}
        onSearchProjects={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(screen.getByLabelText("Find your project on nearbuilders.org")).toBeTruthy();
    expect(screen.queryByLabelText("Source ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "Register source" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Enter manually" }));

    expect(screen.getByLabelText("Source ID")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enter manually" })).toBeNull();
  });

  it("opens straight to the details when a draft already fills them", () => {
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={vi.fn()}
        onImportProject={vi.fn()}
        defaults={{ sourceId: "agent-app", displayName: "Agent App" }}
      />,
    );

    expect((screen.getByLabelText("Source ID") as HTMLInputElement).value).toBe("agent-app");
    expect(screen.queryByRole("button", { name: "Enter manually" })).toBeNull();
  });
});
