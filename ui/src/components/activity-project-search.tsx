import {
  ArrowSquareOutIcon as ArrowSquareOut,
  MagnifyingGlassIcon as MagnifyingGlass,
  PencilSimpleIcon as PencilSimple,
} from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export interface ActivityProjectSearchResult {
  id: string;
  slug: string;
  title: string;
  url: string;
  ownerId: string | null;
  ownerAccountIds?: string[];
  logoUrl?: string | null;
}

export interface ActivitySelectedProject {
  title: string;
  url: string;
  logoUrl: string | null;
  ownerSignInAccountId: string | null;
}

const PROJECT_SEARCH_DELAY_MS = 250;

function isProjectLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function projectInitials(title: string): string {
  const words = title
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(" ")
    .filter(Boolean);
  return (
    words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0] ?? "?").slice(0, 2)
  ).toUpperCase();
}

function ProjectMark({ title, logoUrl }: { title: string; logoUrl?: string | null }) {
  return (
    <Avatar className="size-9 shrink-0 rounded-md border border-border">
      {logoUrl && <AvatarImage src={logoUrl} alt="" className="object-cover" />}
      <AvatarFallback className="rounded-md bg-muted text-xs font-semibold text-muted-foreground">
        {projectInitials(title)}
      </AvatarFallback>
    </Avatar>
  );
}

function OwnedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-brand-accent/40 bg-brand-accent/10 px-2 py-0.5 text-xs font-medium text-foreground ${className}`}
    >
      Owned
    </span>
  );
}

export function ActivityProjectSearch({
  selected,
  isImporting,
  error,
  ownedAccountIds,
  onSearch,
  onImport,
  onClear,
  onQueryChange,
  onEnterManually,
}: {
  selected: ActivitySelectedProject | null;
  isImporting: boolean;
  error: string | null;
  ownedAccountIds: string[];
  onSearch?: (query: string) => Promise<ActivityProjectSearchResult[]>;
  onImport: (reference: string, logoUrl?: string | null) => void;
  onClear: () => void;
  onQueryChange: () => void;
  onEnterManually?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ActivityProjectSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const search = useRef(onSearch);
  search.current = onSearch;
  const canSearch = Boolean(onSearch);

  useEffect(() => {
    const trimmed = query.trim();
    const runSearch = search.current;
    if (!runSearch || selected || trimmed.length < 2 || isProjectLink(trimmed)) {
      setResults(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      runSearch(trimmed)
        .then((found) => {
          if (!cancelled) {
            setResults(found);
            setSearchError(null);
          }
        })
        .catch((searchFailure) => {
          if (!cancelled) {
            setResults(null);
            setSearchError(
              searchFailure instanceof Error ? searchFailure.message : "Could not search projects",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, PROJECT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, canSearch]);

  const isOwned = (result: ActivityProjectSearchResult) =>
    (result.ownerAccountIds ?? (result.ownerId ? [result.ownerId] : [])).some((accountId) =>
      ownedAccountIds.includes(accountId),
    );
  const pick = (result: ActivityProjectSearchResult) => onImport(result.id, result.logoUrl);
  const showFillButton = !onSearch || isProjectLink(query);
  const shownError = error ?? searchError;

  return (
    <div className="space-y-2">
      <Label htmlFor="project-reference">Find your project on nearbuilders.org</Label>
      {selected ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
          <ProjectMark title={selected.title} logoUrl={selected.logoUrl} />
          <div className="min-w-0 flex-1">
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:underline"
            >
              <span className="truncate">{selected.title}</span>
              <ArrowSquareOut className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <p className="truncate text-xs text-muted-foreground">
              {selected.ownerSignInAccountId
                ? `Owned by ${selected.ownerSignInAccountId}. That account signs the on-chain link.`
                : "Details filled in below. You can still edit them."}
            </p>
          </div>
          {!selected.ownerSignInAccountId && <OwnedBadge className="hidden sm:inline" />}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setQuery("");
              onClear();
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:flex-1">
            <MagnifyingGlass
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="project-reference"
              value={query}
              autoComplete="off"
              aria-describedby="project-reference-hint"
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchError(null);
                onQueryChange();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const [onlyResult] = results ?? [];
                  if (results?.length === 1 && onlyResult) pick(onlyResult);
                  else if (showFillButton && query.trim()) onImport(query.trim());
                }
                if (event.key === "Escape") setResults(null);
              }}
              placeholder={
                onSearch
                  ? "Search by project name, or paste its link"
                  : "https://nearbuilders.org/projects/your-project"
              }
              className="h-11 bg-background pr-10 pl-9"
            />
            {(isSearching || isImporting) && (
              <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
            )}
            {results && (
              <ul
                aria-label="Matching nearbuilders.org projects"
                className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-elevation-md"
              >
                {results.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">
                    No projects match. Check the name, paste the project's link, or enter the
                    details manually.
                  </li>
                ) : (
                  [...results]
                    .sort((a, b) => Number(isOwned(b)) - Number(isOwned(a)))
                    .map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          disabled={isImporting}
                          onClick={() => pick(result)}
                          className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                        >
                          <ProjectMark title={result.title} logoUrl={result.logoUrl} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {result.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              nearbuilders.org/projects/{result.slug}
                            </span>
                          </span>
                          {isOwned(result) && <OwnedBadge />}
                        </button>
                      </li>
                    ))
                )}
              </ul>
            )}
          </div>
          {showFillButton && (
            <Button
              type="button"
              className="h-11"
              onClick={() => onImport(query.trim())}
              disabled={isImporting || !query.trim()}
            >
              {isImporting ? "Filling…" : "Fill from project"}
            </Button>
          )}
          {onEnterManually && (
            <Button type="button" variant="outline" className="h-11" onClick={onEnterManually}>
              <PencilSimple />
              Enter manually
            </Button>
          )}
        </div>
      )}
      {shownError && (
        <p id="project-reference-hint" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}
