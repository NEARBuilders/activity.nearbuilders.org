import { describe, expect, it } from "vitest";
import {
  deriveNearbuildersProjectDraft,
  type NearbuildersProject,
  NearbuildersProjectsClient,
  parseNearbuildersProjectReference,
} from "@/services/nearbuilders-projects";

const activityProject: NearbuildersProject = {
  id: "proj_1791152600182_r4z661r",
  slug: "activity-nearbuilders-org-2erd1k",
  title: "activity.nearbuilders.org",
  ownerId: "nearbuilding.near",
  domain: null,
  apps: [],
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      apps: [{ accountId: null }, { accountId: "legion-clash.near" }],
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
  it("resolves a pasted link through the by-slug endpoint", async () => {
    const requested: string[] = [];
    const client = new NearbuildersProjectsClient("https://nearbuilders.test/api/", async (url) => {
      requested.push(String(url));
      return respond({ data: activityProject });
    });

    await expect(
      client.resolve("https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k"),
    ).resolves.toMatchObject({ sourceId: "activity.nearbuilders.org" });
    expect(requested).toEqual([
      "https://nearbuilders.test/api/v1/projects/by-slug/activity-nearbuilders-org-2erd1k",
    ]);
  });

  it("searches by name, preferring an exact title match", async () => {
    const client = new NearbuildersProjectsClient("https://nearbuilders.test/api", async () =>
      respond({
        data: [
          { ...activityProject, id: "proj_a", title: "Test Project Extended", slug: "a-1a2b3c" },
          { ...activityProject, id: "proj_b", title: "Test Project", slug: "test-project-9z8y7x" },
        ],
      }),
    );

    await expect(client.resolve("test project")).resolves.toMatchObject({
      project: { id: "proj_b" },
      sourceId: "test-project",
    });
  });

  it("lists candidate links when a name is ambiguous", async () => {
    const client = new NearbuildersProjectsClient("https://nearbuilders.test/api", async () =>
      respond({
        data: [
          { ...activityProject, title: "Legion Clash", slug: "legion-clash-y1u7id" },
          { ...activityProject, title: "Legion Clash", slug: "legion-clash-9xxnri" },
        ],
      }),
    );

    await expect(client.resolve("Legion Clash")).rejects.toThrow(
      /https:\/\/nearbuilders\.org\/projects\/legion-clash-y1u7id/,
    );
  });

  it("reports a missing linked project without falling back to a name search", async () => {
    const requested: string[] = [];
    const client = new NearbuildersProjectsClient("https://nearbuilders.test/api", async (url) => {
      requested.push(String(url));
      return respond({}, 404);
    });

    await expect(
      client.resolve("https://nearbuilders.org/projects/project/gone-a1b2c3?kind=project"),
    ).rejects.toThrow(
      "No nearbuilders.org project exists at https://nearbuilders.org/projects/project/gone-a1b2c3?kind=project",
    );
    expect(requested).toEqual(["https://nearbuilders.test/api/v1/projects/by-slug/gone-a1b2c3"]);
  });

  it("reports a missing project and an unreachable site distinctly", async () => {
    const missing = new NearbuildersProjectsClient("https://nearbuilders.test/api", async (url) =>
      String(url).includes("by-slug") ? respond({}, 404) : respond({ data: [] }),
    );
    await expect(missing.resolve("no-such-project")).rejects.toThrow(
      'No nearbuilders.org project matches "no-such-project"',
    );

    const offline = new NearbuildersProjectsClient("https://nearbuilders.test/api", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.resolve("nearly-trade")).rejects.toThrow(
      "nearbuilders.org could not be reached",
    );
  });
});

describe("NearbuildersProjectsClient.search", () => {
  it("asks for real projects only and returns linkable summaries", async () => {
    const requested: string[] = [];
    const client = new NearbuildersProjectsClient(
      "https://nearbuilders.org/api/",
      async (input) => {
        requested.push(String(input));
        return respond({
          data: [{ ...activityProject, logoUrl: "https://example.com/logo.png" }],
        });
      },
    );

    const results = await client.search("  activity ");

    expect(requested).toEqual([
      "https://nearbuilders.org/api/v1/projects?query=activity&kind=project&limit=8",
    ]);
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
    let calls = 0;
    const client = new NearbuildersProjectsClient("https://nearbuilders.org/api", async () => {
      calls += 1;
      return respond({ data: [] });
    });

    expect(await client.search(" a ")).toEqual([]);
    expect(calls).toBe(0);
  });

  it("caps the results even when the site returns more", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...activityProject,
      id: `proj_${index}`,
      slug: `project-${index}`,
    }));
    const client = new NearbuildersProjectsClient("https://nearbuilders.org/api", async () =>
      respond({ data: many }),
    );

    expect(await client.search("project")).toHaveLength(8);
  });
});
