import { createFileRoute } from "@tanstack/react-router";
import { type Organization, sessionQueryOptions } from "@/app";
import { OrganizationDetailPage } from "@/components";

export const Route = createFileRoute("/_layout/_authenticated/organizations/$slug")({
  head: () => ({
    title: "Organization | NEAR Builders Activity",
    meta: [{ name: "description", content: "Manage organization details and members." }],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
    await context.queryClient.ensureQueryData({
      queryKey: ["organizations"],
      queryFn: async () => {
        const { data } = await context.authClient.organization.list();
        return (data || []) as Organization[];
      },
      staleTime: 30 * 1000,
    });
  },
  component: OrganizationDetailRoute,
});

function OrganizationDetailRoute() {
  const { slug } = Route.useParams();
  return <OrganizationDetailPage orgSlug={slug} />;
}
