export type GitHubRepositoryEventsResult = {
  status: "modified" | "not_modified";
  events: unknown[];
  etag: string | null;
  pollIntervalSeconds: number;
};

export class GitHubPollError extends Error {
  readonly retryAt: Date;

  constructor(message: string, retryAt = new Date(Date.now() + 60_000)) {
    super(message);
    this.name = "GitHubPollError";
    this.retryAt = retryAt;
  }
}

export class GitHubRateLimitError extends GitHubPollError {
  constructor(retryAt: Date) {
    super("GitHub API rate limit reached", retryAt);
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubRepositoryNotPublicError extends GitHubPollError {
  constructor() {
    super("GitHub repository was not found or is not public");
    this.name = "GitHubRepositoryNotPublicError";
  }
}

export class GitHubEventsClient {
  readonly #fetch: typeof fetch;
  readonly #token?: string;
  readonly #baseUrl: string;

  constructor(options: { fetch?: typeof fetch; token?: string; baseUrl?: string } = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#token = options.token;
    this.#baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  async assertPublicRepository(input: {
    owner: string;
    repository: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = await this.#request(
      `${this.#baseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`,
      this.#headers(),
      input.signal,
    );
    if (response.status === 404) throw new GitHubRepositoryNotPublicError();
    if (response.status === 403 || response.status === 429) {
      throw new GitHubRateLimitError(rateLimitRetryAt(response.headers));
    }
    if (!response.ok) {
      throw new GitHubPollError(`GitHub repository lookup returned HTTP ${response.status}`);
    }
    let repository: unknown;
    try {
      repository = await response.json();
    } catch {
      throw new GitHubPollError("GitHub repository lookup returned invalid JSON");
    }
    if (!isRecord(repository) || repository.private !== false) {
      throw new GitHubRepositoryNotPublicError();
    }
  }

  async pollRepository(input: {
    owner: string;
    repository: string;
    etag?: string | null;
    signal?: AbortSignal;
  }): Promise<GitHubRepositoryEventsResult> {
    const events: unknown[] = [];
    let page = 1;
    let etag = input.etag ?? null;
    let pollIntervalSeconds = 60;
    while (page <= 3) {
      const headers = this.#headers();
      if (page === 1 && input.etag) headers.set("if-none-match", input.etag);
      const response = await this.#request(
        `${this.#baseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/events?per_page=100&page=${page}`,
        headers,
        input.signal,
      );
      if (page === 1) {
        pollIntervalSeconds = parsePollInterval(response.headers.get("x-poll-interval"));
        etag = response.headers.get("etag") ?? etag;
      }
      if (response.status === 304) {
        return { status: "not_modified", events: [], etag, pollIntervalSeconds };
      }
      if (response.status === 403 || response.status === 429) {
        throw new GitHubRateLimitError(rateLimitRetryAt(response.headers));
      }
      if (!response.ok) {
        throw new GitHubPollError(`GitHub repository events returned HTTP ${response.status}`);
      }
      let pageEvents: unknown;
      try {
        pageEvents = await response.json();
      } catch {
        throw new GitHubPollError("GitHub repository events returned invalid JSON");
      }
      if (!Array.isArray(pageEvents)) {
        throw new GitHubPollError("GitHub repository events response must be an array");
      }
      events.push(...pageEvents);
      if (!hasNextPage(response.headers.get("link"))) break;
      page += 1;
    }
    return { status: "modified", events, etag, pollIntervalSeconds };
  }

  #headers(): Headers {
    const headers = new Headers({
      accept: "application/vnd.github+json",
      "user-agent": "activity.nearbuilders.org",
      "x-github-api-version": "2022-11-28",
    });
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    return headers;
  }

  async #request(url: string, headers: Headers, externalSignal?: AbortSignal): Promise<Response> {
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000);
    try {
      return await this.#fetch(url, { headers, redirect: "follow", signal });
    } catch (error) {
      if (error instanceof GitHubPollError) throw error;
      throw new GitHubPollError("GitHub request failed");
    }
  }
}

function parsePollInterval(value: string | null): number {
  const seconds = Number.parseInt(value ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3_600) : 60;
}

function rateLimitRetryAt(headers: Headers): Date {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) return new Date(Date.now() + Math.max(seconds, 1) * 1_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return new Date(timestamp);
  }
  const reset = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
  if (Number.isFinite(reset)) return new Date(reset * 1_000);
  return new Date(Date.now() + 60_000);
}

function hasNextPage(link: string | null): boolean {
  return link?.split(",").some((part) => /rel="next"/.test(part)) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
