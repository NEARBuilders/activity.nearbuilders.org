import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

const now = Date.parse("2026-09-30T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it.each([
    ["2026-09-30T11:59:30.000Z", "just now"],
    ["2026-09-30T11:57:00.000Z", "3 minutes ago"],
    ["2026-09-30T09:00:00.000Z", "3 hours ago"],
    ["2026-09-29T12:00:00.000Z", "yesterday"],
    ["2026-09-16T12:00:00.000Z", "2 weeks ago"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatRelativeTime(value, now)).toBe(expected);
  });
});
