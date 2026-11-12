import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ActivityRequestContext } from "@/lib/activity-context";

const SOURCE_ROOT = join(import.meta.dirname, "../../src");
const AUTH_LIBRARY_FILES = new Set(["lib/auth.ts", "lib/auth-types.gen.ts"]);
const AUTH_SESSION_ACCESS = [
  /\bcontext\s*(?:\??\.\s*|\??\.?\[\s*["'`])session\b/,
  /\bAuthSession(?:Data)?\b/,
  /\bgetSession\s*\(/,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("identity keying", () => {
  it("removes the auth session from the handler context type", () => {
    expectTypeOf<ActivityRequestContext>().not.toHaveProperty("session");
    expectTypeOf<ActivityRequestContext>().toHaveProperty("userId");
  });

  it("never reads the auth session outside the auth library", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .map((path) => relative(SOURCE_ROOT, path))
      .filter((path) => !AUTH_LIBRARY_FILES.has(path))
      .filter((path) => {
        const source = withoutComments(readFileSync(join(SOURCE_ROOT, path), "utf8"));
        return AUTH_SESSION_ACCESS.some((pattern) => pattern.test(source));
      });

    expect(offenders).toEqual([]);
  });
});
