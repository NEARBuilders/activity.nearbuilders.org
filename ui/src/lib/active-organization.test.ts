import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { synchronizeActiveOrganization } from "@/lib/active-organization";

describe("synchronizeActiveOrganization", () => {
  it("makes the selected organization visible before refreshing route context", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], {
      session: { activeOrganizationId: null },
    });
    const events: string[] = [];
    const observedDuringRouterRefresh: Array<string | null> = [];
    const invalidateRouter = vi.fn(async () => {
      events.push("router refreshed");
      const session = queryClient.getQueryData<{
        session: { activeOrganizationId: string | null };
      }>(["session"]);
      observedDuringRouterRefresh.push(session?.session.activeOrganizationId ?? null);
    });

    await synchronizeActiveOrganization({
      organizationId: "org-saad",
      queryClient,
      setActiveOrganization: async () => {
        events.push("organization switched");
      },
      confirmActiveOrganization: async () => {
        events.push("session confirmed");
        return "org-saad";
      },
      invalidateRouter,
    });

    expect(events).toEqual(["organization switched", "session confirmed", "router refreshed"]);
    expect(observedDuringRouterRefresh).toEqual(["org-saad"]);
    expect(
      queryClient.getQueryData<{
        session: { activeOrganizationId: string | null };
      }>(["session"])?.session.activeOrganizationId,
    ).toBe("org-saad");
  });

  it("does not refresh route context when the API session has not switched", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], {
      session: { activeOrganizationId: null },
    });
    const invalidateRouter = vi.fn();

    await expect(
      synchronizeActiveOrganization({
        organizationId: "org-saad",
        queryClient,
        setActiveOrganization: async () => undefined,
        confirmActiveOrganization: async () => null,
        invalidateRouter,
      }),
    ).rejects.toThrow("The selected workspace was not confirmed");

    expect(invalidateRouter).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{
        session: { activeOrganizationId: string | null };
      }>(["session"])?.session.activeOrganizationId,
    ).toBeNull();
  });

  it("restores the previous session when switching the organization fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], {
      session: { activeOrganizationId: "org-before" },
    });
    const confirmActiveOrganization = vi.fn();
    const invalidateRouter = vi.fn();

    await expect(
      synchronizeActiveOrganization({
        organizationId: "org-after",
        queryClient,
        setActiveOrganization: async () => {
          throw new Error("Switch failed");
        },
        confirmActiveOrganization,
        invalidateRouter,
      }),
    ).rejects.toThrow("Switch failed");

    expect(confirmActiveOrganization).not.toHaveBeenCalled();
    expect(invalidateRouter).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{
        session: { activeOrganizationId: string | null };
      }>(["session"])?.session.activeOrganizationId,
    ).toBe("org-before");
  });
});

it("does not expose an unconfirmed workspace to mounted query consumers", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["session"], { session: { activeOrganizationId: null } });
  const observed: unknown[] = [];
  const observe = () =>
    observed.push(
      queryClient.getQueryData<{ session: { activeOrganizationId: string | null } }>(["session"])
        ?.session.activeOrganizationId,
    );
  await synchronizeActiveOrganization({
    organizationId: "org-next",
    queryClient,
    setActiveOrganization: async () => {
      observe();
    },
    confirmActiveOrganization: async () => {
      observe();
      return "org-next";
    },
    invalidateRouter: async () => {},
  });
  expect(observed).toEqual([null, null]);
});

it("does not restore a session invalidated by an unauthorized response", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["session"], { session: { activeOrganizationId: "org-before" } });
  await expect(
    synchronizeActiveOrganization({
      organizationId: "org-after",
      queryClient,
      setActiveOrganization: async () => {
        queryClient.setQueryData(["session"], null);
        throw new Error("Unauthorized");
      },
      confirmActiveOrganization: async () => null,
      invalidateRouter: async () => {},
    }),
  ).rejects.toThrow("Unauthorized");
  expect(queryClient.getQueryData(["session"])).toBeNull();
});
