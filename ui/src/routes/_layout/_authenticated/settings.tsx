import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/app";
import { Tabs, TabsList, TabsTrigger } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/_layout/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings | NEAR Builders Activity" },
      { name: "description", content: "Manage your account identity and security." },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
  },
  component: SettingsLayout,
});

const tabs = [
  { value: "profile", to: "/settings/profile", label: "Profile" },
  { value: "auth-methods", to: "/settings/auth-methods", label: "Auth Methods" },
  { value: "security", to: "/settings/security", label: "Security" },
] as const;

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeTab =
    tabs.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.value ?? "profile";

  return (
    <PageContainer variant="default">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
            </div>
          </div>
        </header>

        <Tabs value={activeTab} className="w-full min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} asChild className="shrink-0">
                <Link to={tab.to}>{tab.label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Outlet />
      </div>
    </PageContainer>
  );
}
