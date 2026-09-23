import { describe, expect, it } from "bun:test";
import { extractHeadings, PUBLISHED_DOCS, rewriteLinks, stripLeadingTitle } from "./sync-docs";

describe("rewriteLinks", () => {
  it("points links between published documents at site routes", () => {
    expect(rewriteLinks("see [the guide](integration-guide.md)")).toBe(
      "see [the guide](/docs/integration-guide)",
    );
    expect(rewriteLinks("see [admin](./admin-guide.md)")).toBe("see [admin](/docs/admin-guide)");
  });

  it("keeps anchors when rewriting", () => {
    expect(rewriteLinks("[retract](integration-guide.md#retract-an-event-you-published)")).toBe(
      "[retract](/docs/integration-guide#retract-an-event-you-published)",
    );
  });

  it("sends unpublished documents to the repository instead of a dead link", () => {
    expect(rewriteLinks("[infra](activity-infrastructure.md#health-check)")).toBe(
      "[infra](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/docs/activity-infrastructure.md#health-check)",
    );
  });

  it("resolves paths that escape the docs directory against the repository root", () => {
    expect(rewriteLinks("[example](../examples/activity-client.ts)")).toBe(
      "[example](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/examples/activity-client.ts)",
    );
  });

  it("leaves absolute links, bare anchors, and mailto alone", () => {
    const untouched =
      "[site](https://everything.dev/) [top](#before-you-start) [mail](mailto:a@b.test)";
    expect(rewriteLinks(untouched)).toBe(untouched);
  });

  it("does not corrupt inline code or images that contain parentheses", () => {
    expect(rewriteLinks("![logo](logo.png)")).toBe(
      "![logo](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/docs/logo.png)",
    );
  });

  it("publishes a unique slug per document", () => {
    const slugs = PUBLISHED_DOCS.map(({ slug }) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("stripLeadingTitle", () => {
  it("removes the leading title, which the page header already shows", () => {
    expect(stripLeadingTitle("# Integrate with Activity\n\nBody text.\n")).toBe("Body text.\n");
  });

  it("keeps headings that are not the leading title", () => {
    expect(stripLeadingTitle("Intro.\n\n# Later heading\n")).toBe("Intro.\n\n# Later heading\n");
    expect(stripLeadingTitle("## Section\n\nBody.\n")).toBe("## Section\n\nBody.\n");
  });
});

describe("extractHeadings", () => {
  it("collects section headings with slugs that match rendered anchors", () => {
    expect(extractHeadings("## Before you start\n\n### Sub section\n\ntext\n")).toEqual([
      { depth: 2, text: "Before you start", slug: "before-you-start" },
      { depth: 3, text: "Sub section", slug: "sub-section" },
    ]);
  });

  it("ignores the title and anything deeper than a sub-section", () => {
    expect(extractHeadings("# Title\n\n#### Too deep\n")).toEqual([]);
  });

  it("ignores comments inside fenced code blocks", () => {
    const markdown = "## Real\n\n```bash\n## not a heading\n```\n\n## Also real\n";
    expect(extractHeadings(markdown).map(({ text }) => text)).toEqual(["Real", "Also real"]);
  });

  it("strips inline formatting from the heading text", () => {
    expect(extractHeadings("## Use `occurredAt` and **bold**\n")).toEqual([
      { depth: 2, text: "Use occurredAt and bold", slug: "use-occurredat-and-bold" },
    ]);
  });

  it("disambiguates repeated headings the way the renderer does", () => {
    expect(extractHeadings("## Setup\n\n## Setup\n").map(({ slug }) => slug)).toEqual([
      "setup",
      "setup-1",
    ]);
  });
});
