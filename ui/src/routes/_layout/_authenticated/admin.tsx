import { ShieldIcon as Shield, UsersIcon as Users } from "@phosphor-icons/react/ssr";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getAccount } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { InfoRow } from "@/components/ui/info-row";

export const Route = createFileRoute("/_layout/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin | NEAR Builders Activity" }],
  }),
  beforeLoad: async ({ context }) => {
    const { apiClient, runtimeConfig } = context;
    const accountId = getAccount(runtimeConfig);
    let tenant: Awaited<ReturnType<typeof apiClient.resolveTenant>> | null = null;
    try {
      tenant = await apiClient.resolveTenant({ accountId });
    } catch {
      tenant = null;
    }
    if (!tenant) {
      throw redirect({ to: "/" });
    }
    return { tenant };
  },
  component: AdminPage,
});

function AdminPage() {
  const { tenant, session } = Route.useRouteContext();

  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const isMember = !!tenant && !!activeOrgId && activeOrgId === tenant.orgId;
  const isAdmin = session?.user?.role === "admin";
  const authorized = isMember || isAdmin;

  if (!tenant) return null;

  if (!authorized) {
    return (
      <EmptyState
        icon={Shield}
        title="Not authorized"
        description={
          <>
            You need to be a member of <span className="font-mono">{tenant.subdomain}</span>'s
            organization to access tenant admin.
          </>
        }
        action={
          <div className="flex justify-center gap-2">
            <Link
              to="/"
              className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground transition-colors rounded-[12px]"
            >
              home
            </Link>
            <Link
              to="/organizations"
              className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground transition-colors rounded-[12px]"
            >
              organizations
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <PageContainer variant="wide">
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {tenant.name}
              </h1>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Subdomain" value={tenant.subdomain} mono />
          <StatCard label="Account" value={tenant.accountId} mono />
          <StatCard
            label="Organization"
            value={
              <Link
                to="/organizations/$slug"
                params={{ slug: tenant.subdomain }}
                className="text-foreground hover:underline font-mono"
              >
                {tenant.subdomain}
              </Link>
            }
          />
          <StatCard
            label="Created"
            value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader title="Tenant details" />
          <section className="space-y-4 border-t border-border py-6">
            <div className="text-muted-foreground text-sm font-medium">Configuration</div>
            <div className="flex flex-col gap-2">
              <InfoRow label="name" value={tenant.name} />
              <InfoRow label="subdomain" value={tenant.subdomain} mono />
              <InfoRow label="account" value={tenant.accountId} mono />
              <InfoRow label="org Id" value={tenant.orgId} mono />
              <InfoRow
                label="created"
                value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
              />
            </div>
          </section>
        </section>

        <section className="space-y-3">
          <SectionHeader title="Members & permissions" />
          <section className="space-y-3 border-t border-border py-6">
            <p className="text-sm text-muted-foreground">
              This tenant is backed by an organization. Manage members, roles, and invitations
              there.
            </p>
            <Link
              to="/organizations/$slug"
              params={{ slug: tenant.subdomain }}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-border bg-card text-foreground transition-colors rounded-[10px]"
            >
              <Users className="h-3.5 w-3.5" />
              open organization
            </Link>
          </section>
        </section>
      </div>
    </PageContainer>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="border-t border-border py-4 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={`text-sm text-foreground break-all ${mono ? "font-mono text-xs" : "font-semibold"}`}
      >
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {action}
    </div>
  );
}
