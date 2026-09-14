import { BroadcastIcon, HouseIcon, PulseIcon, ShieldIcon } from "@phosphor-icons/react/ssr";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { getAccount, sessionQueryOptions, useAuthClient } from "@/app";
import { BetaBanner } from "@/components/beta-banner";
import { BrandElement } from "@/components/brand-element";
import { ThemeToggle } from "@/components/theme-toggle";
import { NetworkToggle } from "@/components/ui/network-toggle";
import { UserNav } from "@/components/user-nav";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient, apiClient } = context;
    const [session, tenant] = await Promise.all([
      queryClient.ensureQueryData(sessionQueryOptions(authClient, context.session)),
      apiClient.resolveTenant({ accountId: getAccount(context.runtimeConfig) }),
    ]);
    return { runtimeConfig: context.runtimeConfig, session, tenant };
  },
  component: Layout,
});

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  return (
    <div className="min-h-dvh bg-background">
      <AppHeader />
      <ClientOnly>
        {isNavigating && (
          <div
            role="progressbar"
            aria-label="Loading page"
            className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
          />
        )}
      </ClientOnly>
      {pathname !== "/login" && <BetaBanner />}
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

function AppHeader() {
  const { session, tenant } = Route.useRouteContext();
  const auth = useAuthClient();
  const { data: liveSession } = useQuery(sessionQueryOptions(auth, session));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === "/login";
  const activeOrgId = liveSession?.session?.activeOrganizationId;
  const isTenantMember = !!tenant && !!activeOrgId && activeOrgId === tenant.orgId;
  const items = [
    { icon: PulseIcon, label: "Activity", to: "/activity" },
    ...(liveSession?.user
      ? [
          { icon: HouseIcon, label: "Overview", to: "/home" },
          { icon: BroadcastIcon, label: "Sources", to: "/activity-sources" },
          ...(isTenantMember ? [{ icon: ShieldIcon, label: "Admin", to: "/admin" }] : []),
        ]
      : []),
  ];
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 shadow-elevation-sm backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-screen-2xl flex-wrap items-center gap-x-4 px-4 py-2 sm:px-6 lg:py-0">
        <Link
          to="/activity"
          aria-label="NEAR Builders Activity home"
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandElement appName="NEAR Builders" size="sm" />
          <span className="hidden text-sm font-semibold sm:inline">NEAR Builders</span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="order-last flex w-full gap-1 overflow-x-auto pb-2 lg:order-none lg:w-auto lg:pb-0"
        >
          {items.map(({ icon: Icon, label, to }) => {
            const active = pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{label}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-brand-accent lg:inset-x-2"
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {isLogin && <NetworkToggle />}
          <ThemeToggle />
          {!isLogin && <UserNav />}
        </div>
      </div>
    </header>
  );
}
