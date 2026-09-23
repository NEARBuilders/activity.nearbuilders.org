import { describe, expect, it } from "bun:test";
import { PUBLISHED_DOCS, rewriteLinks } from "./sync-docs";

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
