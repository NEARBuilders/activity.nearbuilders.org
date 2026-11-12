import { ORPCError } from "@orpc/server";
import { ACTIVITY_SOURCE_ID_REGEX, NEAR_ACCOUNT_ID_REGEX } from "../contract";
import type { PluginsClient } from "../lib/plugins-types.gen";

export const NEARBUILDERS_SITE_URL = "https://nearbuilders.org";

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RANDOM_SLUG_SUFFIX_REGEX = /-(?=[a-z0-9]{6}$)(?=[a-z]*\d)[a-z0-9]{6}$/;
const NEARBUILDERS_HOSTS = new Set(["nearbuilders.org", "www.nearbuilders.org"]);
const PROJECT_KIND_SEGMENTS = new Set(["project", "idea", "scope", "result"]);

export type ProjectsRpcClient = ReturnType<PluginsClient["projects"]["client"]>;

type ProjectRecord = Awaited<ReturnType<ProjectsRpcClient["getProject"]>>["data"];
type ProjectListItem = Awaited<ReturnType<ProjectsRpcClient["listProjects"]>>["data"][number];

export type NearbuildersProject = Pick<
  ProjectListItem,
  "id" | "slug" | "title" | "ownerId" | "domain" | "logoUrl"
> & { apps?: Array<Pick<ProjectRecord["apps"][number], "accountId">> };

export interface NearbuildersProjectSummary {
  id: string;
  slug: string;
  title: string;
  url: string;
  domain: string | null;
  logoUrl: string | null;
  ownerId: string | null;
  ownerAccountIds: string[];
}

export const NEARBUILDERS_PROJECT_SEARCH_LIMIT = 8;

function nearbuildersProjectUrl(slug: string): string {
  return `${NEARBUILDERS_SITE_URL}/projects/${slug}`;
}

function isNearAccountId(accountId: unknown): accountId is string {
  return typeof accountId === "string" && NEAR_ACCOUNT_ID_REGEX.test(accountId);
}

export function projectOwnerAccountIds(project: NearbuildersProject): string[] {
  return [
    ...new Set(
      [...(project.apps ?? []).map(({ accountId }) => accountId), project.ownerId].filter(
        isNearAccountId,
      ),
    ),
  ];
}

export type NearbuildersProjectReference =
  | { kind: "slug"; slug: string; fromLink?: boolean }
  | { kind: "id"; id: string }
  | { kind: "name"; name: string };

export interface NearbuildersProjectDraft {
  project: { id: string; slug: string; title: string; url: string };
  sourceId?: string;
  displayName: string;
  nearAccountId?: string;
}

export function parseNearbuildersProjectReference(input: string): NearbuildersProjectReference {
  const reference = input.trim();
  if (/^https?:\/\//i.test(reference)) {
    let url: URL;
    try {
      url = new URL(reference);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "That project link is not a valid URL" });
    }
    const [section, ...rest] = url.pathname.split("/").filter(Boolean);
    const slug =
      rest.length === 1 || (rest.length === 2 && PROJECT_KIND_SEGMENTS.has(rest[0] ?? ""))
        ? rest.at(-1)
        : undefined;
    if (!NEARBUILDERS_HOSTS.has(url.hostname) || section !== "projects" || !slug) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Paste a project link like https://nearbuilders.org/projects/<slug>",
      });
    }
    return { kind: "slug", slug: decodeURIComponent(slug).toLowerCase(), fromLink: true };
  }
  if (/^proj_[a-z0-9_]+$/i.test(reference)) return { kind: "id", id: reference };
  if (PROJECT_SLUG_REGEX.test(reference)) return { kind: "slug", slug: reference };
  return { kind: "name", name: reference };
}

function asSourceId(candidate: string | null | undefined): string | undefined {
  if (!candidate) return undefined;
  const normalized = candidate
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .slice(0, 100)
    .replace(/[._-]+$/, "");
  return normalized.length >= 2 && ACTIVITY_SOURCE_ID_REGEX.test(normalized)
    ? normalized
    : undefined;
}

export function deriveNearbuildersProjectDraft(
  project: NearbuildersProject,
): NearbuildersProjectDraft {
  const [nearAccountId] = projectOwnerAccountIds(project);
  return {
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      url: nearbuildersProjectUrl(project.slug),
    },
    sourceId:
      asSourceId(project.domain) ??
      asSourceId(project.title) ??
      asSourceId(project.slug.replace(RANDOM_SLUG_SUFFIX_REGEX, "")),
    displayName: project.title.trim().slice(0, 120),
    nearAccountId,
  };
}

const REQUEST_TIMEOUT_MS = 5_000;

const callOptions = () => ({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

function rpcErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function unavailable(error: unknown): ORPCError<string, unknown> {
  const code = rpcErrorCode(error);
  if (code === "NOT_FOUND") {
    return new ORPCError("NOT_FOUND", { message: "nearbuilders.org project not found" });
  }
  return new ORPCError("SERVICE_UNAVAILABLE", {
    message: code
      ? `nearbuilders.org returned ${code}. Try again shortly.`
      : "nearbuilders.org could not be reached. Try again shortly.",
  });
}

function expectData<T>(response: { data?: T } | null | undefined): T {
  if (response?.data === undefined) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "nearbuilders.org returned an unexpected response",
    });
  }
  return response.data;
}

export class NearbuildersProjectsClient {
  readonly #rpc: ProjectsRpcClient;

  constructor(rpc: ProjectsRpcClient) {
    this.#rpc = rpc;
  }

  async resolve(input: string): Promise<NearbuildersProjectDraft> {
    const reference = parseNearbuildersProjectReference(input);
    if (reference.kind === "id") {
      return deriveNearbuildersProjectDraft(await this.#getProject(reference.id, input));
    }
    if (reference.kind === "slug") {
      const project = await this.#findProject(() =>
        this.#rpc.getProjectBySlug({ slug: reference.slug }, callOptions()),
      );
      if (project) return deriveNearbuildersProjectDraft(project);
      if (reference.fromLink) {
        throw new ORPCError("NOT_FOUND", {
          message: `No nearbuilders.org project exists at ${input.trim()}`,
        });
      }
      return deriveNearbuildersProjectDraft(await this.#search(reference.slug, input));
    }
    return deriveNearbuildersProjectDraft(await this.#search(reference.name, input));
  }

  async getOwnerAccountIds(projectId: string): Promise<string[]> {
    return projectOwnerAccountIds(await this.#getProject(projectId, projectId));
  }

  async search(query: string): Promise<NearbuildersProjectSummary[]> {
    const trimmed = query.trim().slice(0, 200);
    if (trimmed.length < 2) return [];
    const matches = await this.#list({
      query: trimmed,
      kind: "project",
      limit: NEARBUILDERS_PROJECT_SEARCH_LIMIT,
    });
    return matches.slice(0, NEARBUILDERS_PROJECT_SEARCH_LIMIT).map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      url: nearbuildersProjectUrl(project.slug),
      domain: project.domain,
      logoUrl: project.logoUrl ?? null,
      ownerId: project.ownerId,
      ownerAccountIds: projectOwnerAccountIds(project),
    }));
  }

  async #search(query: string, input: string): Promise<NearbuildersProject> {
    const matches = await this.#list({ query: query.slice(0, 200) });
    const wanted = query.trim().toLowerCase();
    const exact = matches.filter(
      ({ title, slug }) =>
        title.trim().toLowerCase() === wanted ||
        slug === wanted ||
        slug.replace(RANDOM_SLUG_SUFFIX_REGEX, "") === wanted,
    );
    const candidates = exact.length > 0 ? exact : matches;
    if (candidates.length === 1 && candidates[0]) return candidates[0];
    if (candidates.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: `No nearbuilders.org project matches "${input.trim()}"`,
      });
    }
    throw new ORPCError("BAD_REQUEST", {
      message: `Several nearbuilders.org projects match "${input.trim()}". Use one of these links: ${candidates
        .slice(0, 5)
        .map(({ slug }) => nearbuildersProjectUrl(slug))
        .join(", ")}`,
    });
  }

  async #list(input: Parameters<ProjectsRpcClient["listProjects"]>[0]): Promise<ProjectListItem[]> {
    let response: { data?: ProjectListItem[] };
    try {
      response = await this.#rpc.listProjects(input, callOptions());
    } catch (error) {
      throw unavailable(error);
    }
    return expectData(response);
  }

  async #getProject(id: string, input: string): Promise<NearbuildersProject> {
    const project = await this.#findProject(() => this.#rpc.getProject({ id }, callOptions()));
    if (!project) {
      throw new ORPCError("NOT_FOUND", {
        message: `No nearbuilders.org project matches "${input.trim()}"`,
      });
    }
    return project;
  }

  async #findProject(
    request: () => Promise<{ data?: ProjectRecord }>,
  ): Promise<NearbuildersProject | null> {
    let response: { data?: ProjectRecord };
    try {
      response = await request();
    } catch (error) {
      const failure = unavailable(error);
      if (failure.code === "NOT_FOUND") return null;
      throw failure;
    }
    return expectData(response);
  }
}
