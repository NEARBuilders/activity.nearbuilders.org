// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityGithubIntegration } from "@/components/activity-github-integration";

afterEach(cleanup);

describe("ActivityGithubIntegration", () => {
  it("parses repository and actor mapping lines for an owner save", async () => {
    const onSave = vi.fn();
    render(
      <ActivityGithubIntegration
        sourceId="activity-test"
        configuration={null}
        isLoading={false}
        isSubmitting={false}
        onSave={onSave}
        onPoll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Enable polling"));
    fireEvent.change(screen.getByLabelText("Public repositories"), {
      target: { value: "NEARBuilders/activity.nearbuilders.org" },
    });
    fireEvent.change(screen.getByLabelText("Actor mappings"), {
      target: { value: "alice-builder=alice.near" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save GitHub settings" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        enabled: true,
        mergedPullRequestsEnabled: true,
        closedIssuesEnabled: true,
        repositories: [{ owner: "NEARBuilders", repository: "activity.nearbuilders.org" }],
        actorMappings: [{ githubLogin: "alice-builder", nearAccountId: "alice.near" }],
      }),
    );
  });

  it("explains invalid repository syntax without submitting", async () => {
    const onSave = vi.fn();
    render(
      <ActivityGithubIntegration
        sourceId="activity-test"
        configuration={null}
        isLoading={false}
        isSubmitting={false}
        onSave={onSave}
        onPoll={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Public repositories"), {
      target: { value: "not-a-repository" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save GitHub settings" }));

    expect((await screen.findByRole("alert")).textContent).toContain("use owner/repository");
    expect(onSave).not.toHaveBeenCalled();
  });
});
