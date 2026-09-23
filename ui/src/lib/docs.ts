/**
 * Reads the documentation published to `ui/public/docs/` by `bun run docs:sync`.
 * `docs/` in the repository is the source of truth; these files are generated from it.
 *
 * Loaders run on the server as well as the browser, and a relative URL has nothing to resolve
 * against on the server, so callers pass the host URL from the runtime config when they have it.
 */

export type DocSummary = {
  slug: string;
  title: string;
  description: string;
  audience: string;
};

function isDocSummary(value: unknown): value is DocSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.audience === "string"
  );
}

function docsUrl(path: string, baseUrl?: string): string {
  const base = baseUrl?.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export async function loadDocsManifest(baseUrl?: string): Promise<DocSummary[]> {
  try {
    const response = await fetch(docsUrl("/docs/index.json", baseUrl));
    if (!response.ok) return [];
    const parsed: unknown = await response.json();
    return Array.isArray(parsed) ? parsed.filter(isDocSummary) : [];
  } catch {
    return [];
  }
}

export async function loadDoc(
  slug: string,
  baseUrl?: string,
): Promise<{ summary: DocSummary; content: string } | null> {
  const manifest = await loadDocsManifest(baseUrl);
  const summary = manifest.find((doc) => doc.slug === slug);
  if (!summary) return null;

  try {
    // The slug came from the manifest, so it cannot traverse outside /docs.
    const response = await fetch(docsUrl(`/docs/${slug}.md`, baseUrl));
    if (!response.ok) return null;
    return { summary, content: await response.text() };
  } catch {
    return null;
  }
}
