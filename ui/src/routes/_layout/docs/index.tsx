import {
  BookOpenIcon as BookOpen,
  ArrowSquareOutIcon as ExternalLink,
} from "@phosphor-icons/react/ssr";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
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
      className="block rounded-[10px] border border-border p-5 transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      <span className="text-xs font-mono text-muted-foreground">{doc.audience}</span>
      <h2 className="mt-1 text-base font-semibold text-foreground">{doc.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{doc.description}</p>
    </Link>
  );
}

function DocsIndexPage() {
  const { docs } = Route.useLoaderData();

  return (
    <PageContainer variant="default">
      <div className="space-y-4">
        <div className="border-b border-border pb-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground text-background">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-semibold text-foreground">Documentation</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Activity is a plain HTTP API. Authenticate with a bearer token and send JSON —
                  there is nothing to install.
                </p>
              </div>
            </div>
            <Button variant="outline" asChild>
              <a href="/api" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                API reference
              </a>
            </Button>
          </div>
        </div>

        {docs.length > 0 ? (
          <div className="grid gap-4 py-2 sm:grid-cols-2">
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
