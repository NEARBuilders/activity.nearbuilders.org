/**
 * Publishes selected files from `docs/` to `ui/public/docs/`, so the website can render the same
 * Markdown the repository reviews. `docs/` stays the single source of truth.
 *
 * Run `bun run docs:sync` after editing a published document. CI fails if the output is stale.
 *
 * Relative links are rewritten: a link to a published document becomes a site route, and anything
 * else (unpublished documents, source files) becomes a GitHub link, so no link 404s on the site.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDirectory = join(repositoryRoot, "docs");
const outputDirectory = join(repositoryRoot, "ui", "public", "docs");
const GITHUB_BLOB = "https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main";

type PublishedDoc = {
  slug: string;
  file: string;
  title: string;
  description: string;
  audience: string;
};

/** Order is the order shown on /docs. */
export const PUBLISHED_DOCS: PublishedDoc[] = [
  {
    slug: "integration-guide",
    file: "integration-guide.md",
    title: "Integrate with Activity",
    description:
      "Register a source, get an API key, publish your first event, and read it back from the feed, live stream, and leaderboard.",
    audience: "External projects",
  },
  {
    slug: "admin-guide",
    file: "admin-guide.md",
    title: "Administer Activity",
    description:
      "Review and approve sources, set trust and score multipliers, hide events, and check service health.",
    audience: "Platform Administrators",
  },
  {
    slug: "activity-protocol",
    file: "activity-protocol.md",
    title: "Event protocol",
    description:
      "The signed event envelope, indexed tags, ingestion and idempotency rules, feed cursors, and credential handling.",
    audience: "Implementers",
  },
  {
    slug: "activity-leaderboard",
    file: "activity-leaderboard.md",
    title: "Leaderboard internals",
    description:
      "How raw counts are stored, how scores are computed at read time, and how the projection rebuilds.",
    audience: "Implementers",
  },
];

const slugByFile = new Map(PUBLISHED_DOCS.map((doc) => [doc.file, doc.slug]));

/**
 * Rewrites relative Markdown links so they resolve on the website. Absolute URLs, anchors, and
 * mailto links are left alone.
 */
export function rewriteLinks(markdown: string): string {
  return markdown.replace(/\]\((?!https?:\/\/|#|mailto:)([^)\s]+)\)/g, (_match, target: string) => {
    const [path, anchor] = String(target).split("#");
    const fragment = anchor ? `#${anchor}` : "";
    const fileName = path.replace(/^\.\//, "");

    const slug = slugByFile.get(fileName);
    if (slug) return `](/docs/${slug}${fragment})`;

    // Not published on the site: point at the repository instead of leaving a dead link.
    const repositoryPath = fileName.startsWith("../")
      ? fileName.replace(/^\.\.\//, "")
      : `docs/${fileName}`;
    return `](${GITHUB_BLOB}/${repositoryPath}${fragment})`;
  });
}

function main(): void {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const available = new Set(readdirSync(docsDirectory));
  for (const doc of PUBLISHED_DOCS) {
    if (!available.has(doc.file)) {
      throw new Error(`docs/${doc.file} is listed in PUBLISHED_DOCS but does not exist`);
    }
    const source = readFileSync(join(docsDirectory, doc.file), "utf8");
    writeFileSync(join(outputDirectory, `${doc.slug}.md`), rewriteLinks(source));
  }

  const manifest = PUBLISHED_DOCS.map(({ slug, title, description, audience }) => ({
    slug,
    title,
    description,
    audience,
  }));
  writeFileSync(join(outputDirectory, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Published ${PUBLISHED_DOCS.length} documents to ui/public/docs/`);
}

if (import.meta.main) {
  main();
}
