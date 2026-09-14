// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BetaBanner } from "@/components/beta-banner";

const storage = { getItem: vi.fn(), setItem: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("localStorage", storage);
  storage.getItem.mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("hydrates the server banner before applying a saved dismissal", async () => {
  const markup = renderToString(<BetaBanner />);
  storage.getItem.mockReturnValue("true");
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <BetaBanner />, { onRecoverableError });
  });
  expect(container.textContent).toBe("");
  expect(onRecoverableError).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});

it("can dismiss the banner when browser storage is blocked", () => {
  storage.getItem.mockImplementation(() => {
    throw new Error("Blocked");
  });
  storage.setItem.mockImplementation(() => {
    throw new Error("Blocked");
  });
  render(<BetaBanner />);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss beta banner" }));
  expect(screen.queryByText("Beta")).toBeNull();
});
