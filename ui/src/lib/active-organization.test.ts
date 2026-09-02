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
      confirmActiveOrganization: async () => {
        events.push("session confirmed");
        return "org-saad";
      },
      invalidateRouter,
    });

    expect(events).toEqual(["session confirmed", "router refreshed"]);
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
});
