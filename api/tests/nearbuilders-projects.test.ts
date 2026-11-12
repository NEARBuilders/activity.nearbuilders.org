import { ORPCError } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  deriveNearbuildersProjectDraft,
  type NearbuildersProject,
  NearbuildersProjectsClient,
  type ProjectsRpcClient,
  parseNearbuildersProjectReference,
} from "@/services/nearbuilders-projects";

const activityProject: NearbuildersProject = {
  id: "proj_1791152600182_r4z661r",
  slug: "activity-nearbuilders-org-2erd1k",
  title: "activity.nearbuilders.org",
  ownerId: "nearbuilding.near",
  domain: null,
  logoUrl: null,
  apps: [],
};

type Calls = Array<[string, unknown]>;

function fakeProjects(
  handlers: {
    list?: (input: unknown) => NearbuildersProject[];
    get?: (input: unknown) => NearbuildersProject;
    bySlug?: (input: unknown) => NearbuildersProject;
  },
  calls: Calls = [],
): NearbuildersProjectsClient {
  const call = (name: string, handler?: (input: unknown) => unknown) =>
    vi.fn(async (input: unknown) => {
      calls.push([name, input]);
      if (!handler) throw new ORPCError("NOT_FOUND");
      return { data: handler(input) };
    });
  const rpc = {
    listProjects: call("listProjects", handlers.list ?? (() => [])),
    getProject: call("getProject", handlers.get),
    getProjectBySlug: call("getProjectBySlug", handlers.bySlug),
  } as unknown as ProjectsRpcClient;
  return new NearbuildersProjectsClient(rpc);
}

describe("parseNearbuildersProjectReference", () => {
  it("reads project links, ids, slugs, and names", () => {
    expect(
      parseNearbuildersProjectReference(
        "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k?tab=updates",
      ),
    ).toEqual({ kind: "slug", slug: "activity-nearbuilders-org-2erd1k", fromLink: true });
    expect(
      parseNearbuildersProjectReference(
        "https://nearbuilders.org/projects/project/neptune-ai-vtqq1v?kind=project",
      ),
    ).toEqual({ kind: "slug", slug: "neptune-ai-vtqq1v", fromLink: true });
    expect(
      parseNearbuildersProjectReference("https://nearbuilders.org/projects/idea/some-idea-a1b2c3"),
    ).toEqual({ kind: "slug", slug: "some-idea-a1b2c3", fromLink: true });
    expect(parseNearbuildersProjectReference("proj_1791152600182_r4z661r")).toEqual({
      kind: "id",
      id: "proj_1791152600182_r4z661r",
    });
    expect(parseNearbuildersProjectReference(" nearly-trade ")).toEqual({
      kind: "slug",
      slug: "nearly-trade",
    });
    expect(parseNearbuildersProjectReference("Test Project")).toEqual({
      kind: "name",
      name: "Test Project",
    });
  });

  it("rejects links that are not nearbuilders.org project pages", () => {
    expect(() => parseNearbuildersProjectReference("https://example.com/projects/x")).toThrow(
      "Paste a project link like https://nearbuilders.org/projects/<slug>",
    );
    expect(() => parseNearbuildersProjectReference("https://nearbuilders.org/people/x")).toThrow(
      "Paste a project link like https://nearbuilders.org/projects/<slug>",
    );
    expect(() =>
      parseNearbuildersProjectReference("https://nearbuilders.org/projects/project/a/b"),
    ).toThrow("Paste a project link like https://nearbuilders.org/projects/<slug>");
  });
});

describe("deriveNearbuildersProjectDraft", () => {
  it("uses a domain-like title as the Source ID and the creator as the NEAR account", () => {
    expect(deriveNearbuildersProjectDraft(activityProject)).toEqual({
      project: {
        id: activityProject.id,
        slug: activityProject.slug,
        title: "activity.nearbuilders.org",
        url: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
      },
      sourceId: "activity.nearbuilders.org",
      displayName: "activity.nearbuilders.org",
      nearAccountId: "nearbuilding.near",
    });
  });

  it("falls back to the slug without its random suffix and prefers a linked app account", () => {
    const draft = deriveNearbuildersProjectDraft({
      ...activityProject,
      slug: "legion-clash-weekly-arena-y1u7id",
      title: "Legion Clash: weekly arena",
      apps: [{ accountId: "not a near account" }, { accountId: "legion-clash.near" }],
    });

    expect(draft.sourceId).toBe("legion-clash-weekly-arena");
    expect(draft.nearAccountId).toBe("legion-clash.near");
  });

  it("keeps slugs without a random suffix and prefers the project domain", () => {
    expect(
      deriveNearbuildersProjectDraft({ ...activityProject, slug: "nearly-trade", title: "Nearly" })
        .sourceId,
    ).toBe("nearly");
    expect(
      deriveNearbuildersProjectDraft({
        ...activityProject,
        title: "Some Project",
        domain: "https://app.example.org/",
      }).sourceId,
    ).toBe("app.example.org");
  });
});

describe("NearbuildersProjectsClient", () => {
  it("resolves a pasted link through getProjectBySlug", async () => {
    const calls: Calls = [];
    const client = fakeProjects({ bySlug: () => activityProject }, calls);

    await expect(
      client.resolve("https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k"),
    ).resolves.toMatchObject({ sourceId: "activity.nearbuilders.org" });
    expect(calls).toEqual([["getProjectBySlug", { slug: "activity-nearbuilders-org-2erd1k" }]]);
  });

  it("resolves a project id through getProject", async () => {
    const calls: Calls = [];
    const client = fakeProjects({ get: () => activityProject }, calls);

    await expect(client.resolve(activityProject.id)).resolves.toMatchObject({
      project: { id: activityProject.id },
    });
    expect(calls).toEqual([["getProject", { id: activityProject.id }]]);
  });

  it("searches by name, preferring an exact title match", async () => {
    const client = fakeProjects({
      list: () => [
        { ...activityProject, id: "proj_a", title: "Test Project Extended", slug: "a-1a2b3c" },
        { ...activityProject, id: "proj_b", title: "Test Project", slug: "test-project-9z8y7x" },
      ],
    });

    await expect(client.resolve("test project")).resolves.toMatchObject({
      project: { id: "proj_b" },
      sourceId: "test-project",
    });
  });

  it("lists candidate links when a name is ambiguous", async () => {
    const client = fakeProjects({
      list: () => [
        { ...activityProject, title: "Legion Clash", slug: "legion-clash-y1u7id" },
        { ...activityProject, title: "Legion Clash", slug: "legion-clash-9xxnri" },
      ],
    });

    await expect(client.resolve("Legion Clash")).rejects.toThrow(
      /https:\/\/nearbuilders\.org\/projects\/legion-clash-y1u7id/,
    );
  });

  it("reports a missing linked project without falling back to a name search", async () => {
    const calls: Calls = [];
    const client = fakeProjects({}, calls);

    await expect(
      client.resolve("https://nearbuilders.org/projects/project/gone-a1b2c3?kind=project"),
    ).rejects.toThrow(
      "No nearbuilders.org project exists at https://nearbuilders.org/projects/project/gone-a1b2c3?kind=project",
    );
    expect(calls).toEqual([["getProjectBySlug", { slug: "gone-a1b2c3" }]]);
  });

  it("reports a missing project, an unreachable site and an upstream error distinctly", async () => {
    await expect(fakeProjects({}).resolve("no-such-project")).rejects.toThrow(
      'No nearbuilders.org project matches "no-such-project"',
    );
    await expect(fakeProjects({}).getOwnerAccountIds("proj_gone")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const offline = fakeProjects({
      bySlug: () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.resolve("nearly-trade")).rejects.toThrow(
      "nearbuilders.org could not be reached",
    );

    const failing = fakeProjects({
      list: () => {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      },
    });
    await expect(failing.search("activity")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "nearbuilders.org returned INTERNAL_SERVER_ERROR. Try again shortly.",
    });

    const malformed = fakeProjects({
      bySlug: () => undefined as unknown as NearbuildersProject,
    });
    await expect(malformed.resolve("nearly-trade")).rejects.toThrow(
      "nearbuilders.org returned an unexpected response",
    );
  });
});

describe("NearbuildersProjectsClient.search", () => {
  it("asks for real projects only and returns linkable summaries", async () => {
    const calls: Calls = [];
    const client = fakeProjects(
      { list: () => [{ ...activityProject, logoUrl: "https://example.com/logo.png" }] },
      calls,
    );

    const results = await client.search("  activity ");

    expect(calls).toEqual([["listProjects", { query: "activity", kind: "project", limit: 8 }]]);
    expect(results).toEqual([
      {
        id: "proj_1791152600182_r4z661r",
        slug: "activity-nearbuilders-org-2erd1k",
        title: "activity.nearbuilders.org",
        url: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
        domain: null,
        logoUrl: "https://example.com/logo.png",
        ownerId: "nearbuilding.near",
        ownerAccountIds: ["nearbuilding.near"],
      },
    ]);
  });

  it("skips the request for queries shorter than two characters", async () => {
    const calls: Calls = [];
    const client = fakeProjects({}, calls);

    expect(await client.search(" a ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("caps the results even when the site returns more", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...activityProject,
      id: `proj_${index}`,
      slug: `project-${index}`,
    }));
    const client = fakeProjects({ list: () => many });

    expect(await client.search("project")).toHaveLength(8);
  });
});
