import { describe, expect, it, vi } from "vitest";
import {
  GitHubEventsClient,
  GitHubPollError,
  GitHubRateLimitError,
} from "../src/github/github-events-client";
import { githubIdempotencyKey } from "../src/services/activity-github";

describe("GitHubEventsClient", () => {
  it("accepts only repositories that GitHub identifies as public", async () => {
    const publicFetch: typeof fetch = async () => new Response(JSON.stringify({ private: false }));
    await expect(
      new GitHubEventsClient({ fetch: publicFetch }).assertPublicRepository({
        owner: "acme",
        repository: "widgets",
      }),
    ).resolves.toBeUndefined();

    const privateFetch: typeof fetch = async () => new Response(JSON.stringify({ private: true }));
    await expect(
      new GitHubEventsClient({ fetch: privateFetch }).assertPublicRepository({
        owner: "acme",
        repository: "private-widgets",
      }),
    ).rejects.toThrow("not found or is not public");
  });

  it("follows repository-event pagination up to the retained 300-event window", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      if (requests.length === 1) {
        return new Response(JSON.stringify([{ id: "event-1" }]), {
          headers: {
            etag: '"repository-version"',
            link: '<https://api.github.test/repos/acme/widgets/events?per_page=100&page=2>; rel="next"',
            "x-poll-interval": "90",
          },
        });
      }
      return new Response(JSON.stringify([{ id: "event-2" }]));
    };

    const result = await new GitHubEventsClient({
      fetch: fetcher,
      baseUrl: "https://api.github.test",
    }).pollRepository({ owner: "acme", repository: "widgets" });

    expect(result).toEqual({
      status: "modified",
      events: [{ id: "event-1" }, { id: "event-2" }],
      etag: '"repository-version"',
      pollIntervalSeconds: 90,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.github.test/repos/acme/widgets/events?per_page=100&page=1",
      "https://api.github.test/repos/acme/widgets/events?per_page=100&page=2",
    ]);
  });

  it("sends a persisted ETag and honors a not-modified poll interval", async () => {
    let requestHeaders = new Headers();
    const fetcher: typeof fetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(null, {
        status: 304,
        headers: { etag: '"next-version"', "x-poll-interval": "120" },
      });
    };

    const result = await new GitHubEventsClient({ fetch: fetcher }).pollRepository({
      owner: "acme",
      repository: "widgets",
      etag: '"saved-version"',
    });

    expect(requestHeaders.get("if-none-match")).toBe('"saved-version"');
    expect(result).toEqual({
      status: "not_modified",
      events: [],
      etag: '"next-version"',
      pollIntervalSeconds: 120,
    });
  });

  it("keeps the optional token in the request header only", async () => {
    let authorization: string | null = null;
    const fetcher: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response("[]", { headers: { etag: '"empty"' } });
    };

    const result = await new GitHubEventsClient({
      fetch: fetcher,
      token: "private-test-token",
    }).pollRepository({ owner: "acme", repository: "widgets" });

    expect(authorization).toBe("Bearer private-test-token");
    expect(JSON.stringify(result)).not.toContain("private-test-token");
  });

  it.each([
    [429, { "retry-after": "30" }],
    [403, { "x-ratelimit-reset": "2000000000" }],
  ])("turns HTTP %s rate limits into a scheduled retry", async (status, headers) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const fetcher: typeof fetch = async () => new Response("{}", { status, headers });

    try {
      const poll = new GitHubEventsClient({ fetch: fetcher }).pollRepository({
        owner: "acme",
        repository: "widgets",
      });
      await expect(poll).rejects.toBeInstanceOf(GitHubRateLimitError);
      await poll.catch((error: unknown) => {
        expect(error).toBeInstanceOf(GitHubRateLimitError);
        if (error instanceof GitHubRateLimitError) {
          expect(error.retryAt.getTime()).toBeGreaterThan(Date.now());
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["invalid JSON", new Response("{", { status: 200 })],
    ["non-array JSON", new Response('{"message":"unexpected"}', { status: 200 })],
    ["not found", new Response("{}", { status: 404 })],
  ])("rejects a malformed %s response without advancing state", async (_label, response) => {
    const fetcher: typeof fetch = async () => response;
    const poll = new GitHubEventsClient({ fetch: fetcher }).pollRepository({
      owner: "acme",
      repository: "widgets",
    });

    await expect(poll).rejects.toBeInstanceOf(GitHubPollError);
  });
});

describe("githubIdempotencyKey", () => {
  it("is stable across delivery-event identities and repository casing", () => {
    expect(githubIdempotencyKey("ACME/Widgets", "github.pr.merged", "42")).toBe(
      "github:acme/widgets:github.pr.merged:42",
    );
  });
});
