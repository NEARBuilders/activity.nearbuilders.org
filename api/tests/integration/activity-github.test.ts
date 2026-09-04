import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getPluginClient,
  getTestRelayEvents,
  orgMemberContext,
  orgOwnerContext,
  resetTestRelayEvents,
  restartActivityGithubService,
  teardown,
} from "../setup";

afterAll(teardown);

async function provisionGithubSource() {
  const sourceId = "github-fixture-source";
  const organizationId = "github-fixture-org";
  const owner = await getPluginClient(
    orgOwnerContext("github-fixture-owner", organizationId, "github-fixture-owner.near"),
  );
  await owner.createActivitySource({
    sourceId,
    displayName: "GitHub fixture source",
    nearAccountId: "github-fixture-owner.near",
    eventTypes: [
      {
        name: "github.pr.merged",
        description: "A pull request was merged",
        enabled: true,
        pointValue: 10,
      },
      {
        name: "github.issue.closed",
        description: "An issue was closed",
        enabled: true,
        pointValue: 5,
      },
    ],
  });
  const administrator = await getPluginClient(adminContext());
  await administrator.reviewActivitySource({
    sourceId,
    decision: "approved",
    reason: "GitHub integration fixture",
  });
  await owner.createActivitySigningIdentity({ sourceId });
  const prepared = await owner.prepareActivitySigningIdentityBinding({ sourceId });
  const bindingValue = JSON.parse(prepared.value);
  const originalFetch = globalThis.fetch;
  const bindingFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
    if (String(request).startsWith("https://kv.main.fastnear.com/")) {
      return new Response(JSON.stringify({ entries: [{ value: bindingValue }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(request, init);
  });
  try {
    await owner.confirmActivitySigningIdentityBinding({ sourceId });
  } finally {
    bindingFetch.mockRestore();
  }
  return { owner, sourceId, organizationId };
}

function mergedPullRequestEvent(eventId: string) {
  return {
    id: eventId,
    type: "PullRequestEvent",
    public: true,
    actor: { login: "alice-builder" },
    payload: {
      action: "closed",
      number: 42,
      pull_request: {
        id: 4200,
        number: 42,
        merged: true,
        title: "Ship the Activity poller",
        html_url: "https://github.com/NEARBuilders/activity.nearbuilders.org/pull/42",
        merged_at: "2026-09-04T12:00:00Z",
        user: { login: "pull-request-author" },
      },
    },
  };
}

function closedIssueEvent(eventId: string) {
  return {
    id: eventId,
    type: "IssuesEvent",
    public: true,
    actor: { login: "bob-builder" },
    payload: {
      action: "closed",
      issue: {
        id: 7700,
        number: 77,
        title: "Document poll retention",
        html_url: "https://github.com/NEARBuilders/activity.nearbuilders.org/issues/77",
        closed_at: "2026-09-04T12:05:00Z",
        user: { login: "issue-author" },
      },
    },
  };
}

describe("Activity GitHub integration", () => {
  it("persists resume state, maps actors, quarantines unmapped events, and deduplicates", async () => {
    const { owner, sourceId, organizationId } = await provisionGithubSource();
    const member = await getPluginClient(orgMemberContext("github-member", organizationId));
    await expect(member.getActivityGithubIntegration({ sourceId })).rejects.toThrow(
      "Requires organization role: owner",
    );
    await expect(
      owner.configureActivityGithubIntegration({
        sourceId,
        enabled: true,
        mergedPullRequestsEnabled: true,
        closedIssuesEnabled: false,
        repositories: [],
        actorMappings: [],
      }),
    ).rejects.toThrow("Input validation failed");

    const originalFetch = globalThis.fetch;
    const privateValidationFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (request, init) => {
        if (String(request).startsWith("https://api.github.com/repos/")) {
          return new Response(JSON.stringify({ private: true }));
        }
        return originalFetch(request, init);
      });
    try {
      await expect(
        owner.configureActivityGithubIntegration({
          sourceId,
          enabled: true,
          mergedPullRequestsEnabled: true,
          closedIssuesEnabled: false,
          repositories: [{ owner: "NEARBuilders", repository: "private-repository" }],
          actorMappings: [],
        }),
      ).rejects.toThrow("not found or is not public");
    } finally {
      privateValidationFetch.mockRestore();
    }

    const validationFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (request, init) => {
        if (String(request).startsWith("https://api.github.com/repos/")) {
          return new Response(JSON.stringify({ private: false }));
        }
        return originalFetch(request, init);
      });
    try {
      await owner.configureActivityGithubIntegration({
        sourceId,
        enabled: true,
        mergedPullRequestsEnabled: true,
        closedIssuesEnabled: true,
        repositories: [{ owner: "NEARBuilders", repository: "activity.nearbuilders.org" }],
        actorMappings: [{ githubLogin: "alice-builder", nearAccountId: "alice.near" }],
      });
    } finally {
      validationFetch.mockRestore();
    }

    resetTestRelayEvents();
    let githubRequestHeaders = new Headers();
    const githubFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      if (String(request).startsWith("https://api.github.com/")) {
        githubRequestHeaders = new Headers(init?.headers);
        return new Response(
          JSON.stringify([
            mergedPullRequestEvent("github-delivery-pr-1"),
            closedIssueEvent("github-delivery-issue-1"),
            {
              id: "ignored-open-pr",
              type: "PullRequestEvent",
              public: true,
              payload: { action: "opened", pull_request: { merged: false } },
            },
          ]),
          { headers: { etag: '"fixture-v1"', "x-poll-interval": "75" } },
        );
      }
      return originalFetch(request, init);
    });
    try {
      const firstPoll = await owner.pollActivityGithubIntegration({ sourceId });
      expect(firstPoll).toMatchObject({
        repositoriesPolled: 1,
        published: 1,
        quarantined: 1,
        failed: 0,
      });
    } finally {
      githubFetch.mockRestore();
    }

    expect(githubRequestHeaders.get("authorization")).toBeNull();
    expect(getTestRelayEvents()).toHaveLength(1);
    expect(getTestRelayEvents()[0]?.tags).toContainEqual(["n", "alice.near"]);
    const saved = await owner.getActivityGithubIntegration({ sourceId });
    expect(saved?.repositories[0]).toMatchObject({
      owner: "nearbuilders",
      repository: "activity.nearbuilders.org",
      etag: '"fixture-v1"',
      pollIntervalSeconds: 75,
      lastError: null,
    });
    expect(saved?.quarantineCount).toBe(1);
    expect(await owner.listActivityGithubQuarantine({ sourceId })).toMatchObject([
      {
        githubEventId: "github-delivery-issue-1",
        githubLogin: "bob-builder",
        eventType: "github.issue.closed",
      },
    ]);

    await restartActivityGithubService();

    const mappingValidationFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (request, init) => {
        if (String(request).startsWith("https://api.github.com/repos/")) {
          return new Response(JSON.stringify({ private: false }));
        }
        return originalFetch(request, init);
      });
    try {
      await owner.configureActivityGithubIntegration({
        sourceId,
        enabled: true,
        mergedPullRequestsEnabled: true,
        closedIssuesEnabled: true,
        repositories: [{ owner: "nearbuilders", repository: "activity.nearbuilders.org" }],
        actorMappings: [
          { githubLogin: "alice-builder", nearAccountId: "alice.near" },
          { githubLogin: "bob-builder", nearAccountId: "bob.near" },
        ],
      });
    } finally {
      mappingValidationFetch.mockRestore();
    }

    const beforeInterval = await owner.pollActivityGithubIntegration({ sourceId });
    expect(beforeInterval).toMatchObject({
      repositoriesPolled: 0,
      published: 1,
      notModified: 0,
      failed: 0,
    });
    expect(getTestRelayEvents()).toHaveLength(2);
    expect((await owner.getActivityGithubIntegration({ sourceId }))?.quarantineCount).toBe(0);

    const firstNextPollAt = (await owner.getActivityGithubIntegration({ sourceId }))
      ?.repositories[0]?.nextPollAt;
    expect(firstNextPollAt).toBeTruthy();
    let conditionalEtag: string | null = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(firstNextPollAt ?? "") + 1_000));
    const conditionalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (request, init) => {
        if (String(request).startsWith("https://api.github.com/")) {
          conditionalEtag = new Headers(init?.headers).get("if-none-match");
          return new Response(null, {
            status: 304,
            headers: { etag: '"fixture-v1"', "x-poll-interval": "75" },
          });
        }
        return originalFetch(request, init);
      });
    try {
      const resumedPoll = await owner.pollActivityGithubIntegration({ sourceId });
      expect(resumedPoll).toMatchObject({ published: 0, notModified: 1, failed: 0 });
    } finally {
      conditionalFetch.mockRestore();
      vi.useRealTimers();
    }
    expect(conditionalEtag).toBe('"fixture-v1"');
    expect(getTestRelayEvents()).toHaveLength(2);

    const secondNextPollAt = (await owner.getActivityGithubIntegration({ sourceId }))
      ?.repositories[0]?.nextPollAt;
    expect(secondNextPollAt).toBeTruthy();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(secondNextPollAt ?? "") + 1_000));
    const duplicateFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (request, init) => {
        if (String(request).startsWith("https://api.github.com/")) {
          return new Response(JSON.stringify([mergedPullRequestEvent("github-delivery-pr-2")]), {
            headers: { etag: '"fixture-v2"' },
          });
        }
        return originalFetch(request, init);
      });
    try {
      await owner.pollActivityGithubIntegration({ sourceId });
    } finally {
      duplicateFetch.mockRestore();
      vi.useRealTimers();
    }
    expect(getTestRelayEvents()).toHaveLength(2);
  });
});
