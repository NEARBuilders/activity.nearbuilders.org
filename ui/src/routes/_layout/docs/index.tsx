import {
  ArrowRightIcon as ArrowRight,
  BookOpenIcon as BookOpen,
  ArrowSquareOutIcon as ExternalLink,
} from "@phosphor-icons/react/ssr";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { type DocSummary, loadDocsManifest } from "@/lib/docs";

export const Route = createFileRoute("/_layout/docs/")({
  loader: async ({ context }) => ({
    docs: await loadDocsManifest(context.runtimeConfig?.hostUrl),
  }),
  head: () => ({
    meta: [
      { title: "Documentation | NEAR Builders Activity" },
      {
        name: "description",
        content:
          "Guides for publishing events to Activity, administering sources, and implementing against the event protocol.",
      },
    ],
  }),
  component: DocsIndexPage,
});

function DocCard({ doc }: { doc: DocSummary }) {
  return (
    <Link
      to="/docs/$slug"
      params={{ slug: doc.slug }}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-elevation-sm transition-colors hover:border-foreground/20 hover:bg-muted/40"
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {doc.audience}
      </span>
      <h2 className="flex items-center justify-between gap-2 text-base font-semibold text-foreground">
        {doc.title}
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </h2>
      <p className="text-sm text-muted-foreground">{doc.description}</p>
    </Link>
  );
}

function DocsIndexPage() {
  const { docs } = Route.useLoaderData();

  return (
    <PageContainer variant="wide">
      <PageHeader
        title="Docs"
        description="Activity is a plain HTTP API. Authenticate with a bearer token and send JSON. There's nothing to install."
        actions={
          <Button variant="outline" asChild>
            <a href="/api" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              API reference
            </a>
          </Button>
        }
      />
      <div>
        {docs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {docs.map((doc) => (
              <DocCard key={doc.slug} doc={doc} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-muted-foreground">
            <BookOpen size={32} className="text-border" />
            <p className="text-sm">Documentation is unavailable.</p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
