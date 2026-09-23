import {
  ArrowLeftIcon as ArrowLeft,
  ArrowSquareOutIcon as ExternalLink,
  FileTextIcon as FileText,
} from "@phosphor-icons/react/ssr";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { loadDoc } from "@/lib/docs";

export const Route = createFileRoute("/_layout/docs/$slug")({
  loader: async ({ params, context }) => {
    const doc = await loadDoc(params.slug, context.runtimeConfig?.hostUrl);
    if (!doc) throw notFound();
    return doc;
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
  const { summary, content } = Route.useLoaderData();

  return (
    <PageContainer variant="default">
      <div className="space-y-4">
        <div className="border-b border-border pb-6 space-y-4">
          <Link
            to="/docs"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={12} />
            All documentation
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <span className="text-xs font-mono text-muted-foreground">{summary.audience}</span>
              <h1 className="mt-1 text-base font-semibold text-foreground">{summary.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{summary.description}</p>
            </div>
            <Button variant="outline" asChild>
              <a href={`/docs/${summary.slug}.md`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                raw markdown
              </a>
            </Button>
          </div>
        </div>

        <div className="py-6">
          <Markdown content={content} />
        </div>
      </div>
    </PageContainer>
  );
}
