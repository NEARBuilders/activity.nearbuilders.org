import { describe, expect, it } from "vitest";
import { BoundedEventIdSet } from "@/activity/bounded-event-id-set";

describe("BoundedEventIdSet", () => {
  it("keeps only the most recently added IDs as the stream continues", () => {
    const ids = new BoundedEventIdSet(2);

    ids.add("first");
    ids.add("second");
    ids.add("first");
    ids.add("third");

    expect(ids.size).toBe(2);
    expect(ids.has("first")).toBe(false);
    expect(ids.has("second")).toBe(true);
    expect(ids.has("third")).toBe(true);
  });

  it("does not grow with the number of distinct IDs seen", () => {
    const ids = new BoundedEventIdSet(32);

    for (let index = 0; index < 100_000; index += 1) {
      ids.add(`event-${index}`);
    }

    expect(ids.size).toBe(32);
    expect(ids.has("event-99999")).toBe(true);
    expect(ids.has("event-0")).toBe(false);
  });

  it("can release all retained IDs when the stream closes", () => {
    const ids = new BoundedEventIdSet(2);

    ids.add("first");
    ids.add("second");
    ids.clear();

    expect(ids.size).toBe(0);
  });
});
