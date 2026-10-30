import {
  CheckIcon as Check,
  CopyIcon as Copy,
  ArrowSquareOutIcon as ExternalLink,
  FileTextIcon as FileText,
  PlugsConnectedIcon as PlugsConnected,
} from "@phosphor-icons/react/ssr";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getAccount, getActiveRuntime, getAppName } from "@/app";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { buildActivityMcpPrompt } from "@/lib/activity-mcp-prompt";

export const Route = createFileRoute("/_public/skill")({
  loader: async ({ context }) => {
    const runtimeConfig = context.runtimeConfig;

    const skill = await fetch("/skill.md")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load skill: ${response.status}`);
        }

        return response.text();
      })
      .catch(() => null);

    return {
      runtimeConfig,
      skill,
    };
  },
  head: () => ({
    meta: [
      { title: "Skill | NEAR Builders Activity" },
      {
        name: "description",
        content: "Instructions a coding agent follows to add Activity to a project.",
      },
    ],
  }),
  component: SkillPage,
});

function SkillPage() {
  const { skill, runtimeConfig } = Route.useLoaderData();
  const runtime = getActiveRuntime(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const appName = getAppName(runtimeConfig);
  const [copied, setCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);

  const accountId = runtime?.accountId ?? account;

  const handleCopy = async () => {
    if (!skill) {
      toast.error("Skill prompt unavailable");
      return;
    }

    await navigator.clipboard.writeText(skill);
    setCopied(true);
    toast.success("Skill prompt copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMcp = async () => {
    await navigator.clipboard.writeText(buildActivityMcpPrompt(window.location.origin));
    setMcpCopied(true);
    toast.success("MCP prompt copied");
    setTimeout(() => setMcpCopied(false), 2000);
  };

  return (
    <PageContainer variant="default">
      <div className="space-y-4">
        <div className="border-b border-border pb-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground text-background">
                <FileText size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">{accountId}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-base font-semibold text-foreground">{appName}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Instructions a coding agent follows to add Activity to a project.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleCopy} disabled={!skill}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy prompt"}
              </Button>
              <Button variant="outline" onClick={handleCopyMcp}>
                {mcpCopied ? <Check size={14} /> : <PlugsConnected size={14} />}
                {mcpCopied ? "Copied" : "Copy MCP prompt"}
              </Button>
              <Button variant="outline" asChild>
                <a href="/skill.md" target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  raw skill.md
                </a>
              </Button>
            </div>
          </div>

          <div className="border-t border-border py-4 text-sm text-muted-foreground">
            Ask your coding agent to "integrate activity.nearbuilders.org" and point it at
            `/skill.md`, or copy the prompt above. If your agent supports MCP, copy the MCP prompt
            instead: it connects the agent to `/api/v1/mcp`, which registers the project and hands
            over its key after you approve in the browser.
          </div>
        </div>

        {skill ? (
          <div className="py-6">
            <Markdown content={skill} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3  px-8 py-16 text-muted-foreground">
            <FileText size={32} className="text-border" />
            <p className="text-sm text-muted-foreground">Skill prompt unavailable.</p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
