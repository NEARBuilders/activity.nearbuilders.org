import {
  ArrowLeftIcon as ArrowLeft,
  ArrowSquareOutIcon as ExternalLink,
  FileTextIcon as FileText,
} from "@phosphor-icons/react/ssr";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { DocsToc } from "@/components/docs-toc";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { loadDoc, loadDocsManifest } from "@/lib/docs";

export const Route = createFileRoute("/_layout/docs/$slug")({
  loader: async ({ params, context }) => {
    const baseUrl = context.runtimeConfig?.hostUrl;
    const [doc, manifest] = await Promise.all([
      loadDoc(params.slug, baseUrl),
      loadDocsManifest(baseUrl),
    ]);
    if (!doc) throw notFound();
    return { ...doc, manifest };
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.summary.title} | NEAR Builders Activity` },
            { name: "description", content: loaderData.summary.description },
          ],
        }
      : {},
  component: DocPage,
  notFoundComponent: DocNotFound,
});

function DocNotFound() {
  return (
    <PageContainer variant="default">
      <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-muted-foreground">
        <FileText size={32} className="text-border" />
        <p className="text-sm">That document does not exist.</p>
        <Button variant="outline" asChild>
          <Link to="/docs">
            <ArrowLeft size={14} />
            All documentation
          </Link>
        </Button>
      </div>
    </PageContainer>
  );
}

function DocPage() {
  const { summary, content, manifest } = Route.useLoaderData();
  const others = manifest.filter((doc) => doc.slug !== summary.slug);

  return (
    <PageContainer variant="wide">
      <div className="space-y-6">
        <div className="space-y-3 border-b border-border pb-6">
          <Link
            to="/docs"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={12} />
            All documentation
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-mono text-muted-foreground">{summary.audience}</span>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {summary.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{summary.description}</p>
            </div>
            <Button variant="outline" asChild>
              <a href={`/docs/${summary.slug}.md`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                raw markdown
              </a>
            </Button>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
          <article className="min-w-0">
            <Markdown content={content} />

            {others.length > 0 && (
              <div className="mt-12 border-t border-border pt-6">
                <p className="text-xs font-medium text-muted-foreground">Continue reading</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {others.map((doc) => (
                    <Link
                      key={doc.slug}
                      to="/docs/$slug"
                      params={{ slug: doc.slug }}
                      className="rounded-[10px] border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40"
                    >
                      <span className="text-xs font-mono text-muted-foreground">
                        {doc.audience}
                      </span>
                      <p className="mt-0.5 text-sm font-medium text-foreground">{doc.title}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>

          {/* Sticky beside the article on wide screens; the sticky header is 4rem tall. */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6">
              <DocsToc headings={summary.headings} />
            </div>
          </aside>
        </div>
      </div>
    </PageContainer>
  );
}
