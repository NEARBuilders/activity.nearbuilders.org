import {
  ArrowSquareOutIcon as ArrowSquareOut,
  MagnifyingGlassIcon as MagnifyingGlass,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@phosphor-icons/react/ssr";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  ActivityEventTypeView,
  CreateActivitySourceInput,
} from "@/components/activity-sources-model";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { ActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

const registrationBlocker: Record<
  Exclude<ActivitySourceRegistrationAccess, "allowed">,
  { title: string; description: string }
> = {
  "organization-required": {
    title: "Select an active organization",
    description:
      "An Activity Source belongs to one organization permanently. Choose the organization that will own it, or create a new one.",
  },
  "owner-required": {
    title: "Organization owner required",
    description:
      "Only an owner of the active organization can register an Activity Source. Members cannot register sources or manage credentials. Ask an owner to register it, or switch to an organization you own.",
  },
  "near-required": {
    title: "Connect a NEAR account",
    description:
      "Registering a source requires a mainnet NEAR account. You will sign one on-chain transaction from this account to link it to the source.",
  },
};

const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EVENT_TYPE_NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface ActivityProjectSearchResult {
  id: string;
  slug: string;
  title: string;
  url: string;
  ownerId: string | null;
  ownerAccountIds?: string[];
  logoUrl?: string | null;
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

const PROJECT_SEARCH_DELAY_MS = 250;

function isProjectLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export interface ActivityProjectImport {
  project: { id: string; title: string; url: string };
  sourceId?: string;
  displayName: string;
  nearAccountId?: string;
}

type RegistrationField = "sourceId" | "nearAccountId";

function fieldForError(message: string): RegistrationField | null {
  if (/Source ID/.test(message)) return "sourceId";
  if (/NEAR account/.test(message)) return "nearAccountId";
  return null;
}

const emptyEventType = (): ActivityEventTypeView => ({
  name: "",
  description: "",
  enabled: true,
  pointValue: 0,
});

export function ActivitySourceRegistration({
  access,
  isSubmitting,
  onCreate,
  registrationAction,
  embedded = false,
  defaultNearAccountId = "",
  defaults,
  onImportProject,
  onSearchProjects,
  ownedAccountIds,
  mode = "create",
  onCancel,
}: {
  access: ActivitySourceRegistrationAccess | null;
  isSubmitting: boolean;
  onCreate: (input: CreateActivitySourceInput) => void | Promise<void>;
  registrationAction?: ReactNode;
  embedded?: boolean;
  defaultNearAccountId?: string;
  defaults?: Partial<CreateActivitySourceInput>;
  onImportProject?: (reference: string) => Promise<ActivityProjectImport>;
  onSearchProjects?: (query: string) => Promise<ActivityProjectSearchResult[]>;
  ownedAccountIds?: string[];
  mode?: "create" | "edit";
  onCancel?: () => void;
}) {
  const isEditing = mode === "edit";
  const [sourceId, setSourceId] = useState(defaults?.sourceId ?? "");
  const [displayName, setDisplayName] = useState(defaults?.displayName ?? "");
  const [nearAccountId, setNearAccountId] = useState(
    defaults?.nearAccountId ?? defaultNearAccountId,
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const [eventTypes, setEventTypes] = useState<ActivityEventTypeView[]>(
    defaults?.eventTypes?.length ? defaults.eventTypes : [emptyEventType()],
  );
  const [projectReference, setProjectReference] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedProject, setImportedProject] = useState<ActivityProjectImport["project"] | null>(
    null,
  );
  const [searchResults, setSearchResults] = useState<ActivityProjectSearchResult[] | null>(null);
  const [projectOwnerAccountId, setProjectOwnerAccountId] = useState<string | null>(null);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [importedProjectLogo, setImportedProjectLogo] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchProjects = useRef(onSearchProjects);
  searchProjects.current = onSearchProjects;
  const canSearchProjects = Boolean(onSearchProjects);

  useEffect(() => {
    const query = projectReference.trim();
    const search = searchProjects.current;
    if (!search || importedProject || query.length < 2 || isProjectLink(query)) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      search(query)
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results);
            setImportError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchResults(null);
            setImportError(error instanceof Error ? error.message : "Could not search projects");
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
  }, [projectReference, importedProject, canSearchProjects]);

  if (access === null) {
    return <Card className="h-24 animate-pulse p-5" />;
  }

  if (access !== "allowed") {
    return (
      <Card className="gap-1.5 p-5">
        <h2 className="font-semibold text-foreground">{registrationBlocker[access].title}</h2>
        <p className="text-sm text-muted-foreground">{registrationBlocker[access].description}</p>
        {registrationAction && <div className="mt-3">{registrationAction}</div>}
      </Card>
    );
  }

  const importProject = async (reference = projectReference.trim()) => {
    if (!onImportProject || !reference) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const imported = await onImportProject(reference);
      if (imported.sourceId) setSourceId(imported.sourceId);
      setDisplayName(imported.displayName);
      if (imported.nearAccountId) setNearAccountId(imported.nearAccountId);
      setImportedProject(imported.project);
      setProjectOwnerAccountId(imported.nearAccountId ?? null);
      setProjectReference(imported.project.title);
      setSearchResults(null);
      setFieldErrors({});
    } catch (error) {
      setImportedProject(null);
      setProjectOwnerAccountId(null);
      setImportError(error instanceof Error ? error.message : "Could not import that project");
    } finally {
      setIsImporting(false);
    }
  };

  const selectProject = async (result: ActivityProjectSearchResult) => {
    setImportedProjectLogo(result.logoUrl ?? null);
    await importProject(result.id);
  };

  const signedInAccountIds = ownedAccountIds ?? [];
  const isOwnedProject = (result: ActivityProjectSearchResult) =>
    (result.ownerAccountIds ?? (result.ownerId ? [result.ownerId] : [])).some((accountId) =>
      signedInAccountIds.includes(accountId),
    );
  const ownerSignInAccountId =
    projectOwnerAccountId &&
    nearAccountId.trim() === projectOwnerAccountId &&
    !signedInAccountIds.includes(projectOwnerAccountId)
      ? projectOwnerAccountId
      : null;

  const updateEventType = (index: number, update: Partial<ActivityEventTypeView>) => {
    setEventTypes((current) =>
      current.map((eventType, eventTypeIndex) =>
        eventTypeIndex === index ? { ...eventType, ...update } : eventType,
      ),
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitBlocker) return;
    const nearbuildersProjectId = isEditing
      ? undefined
      : (importedProject?.id ?? defaults?.nearbuildersProjectId);
    try {
      await onCreate({
        sourceId,
        displayName,
        nearAccountId,
        eventTypes,
        ...(nearbuildersProjectId && { nearbuildersProjectId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const field = fieldForError(message);
      if (field) setFieldErrors({ [field]: message });
      return;
    }
    setFieldErrors({});
    if (isEditing) return;
    setImportedProject(null);
    setProjectReference("");
    setSourceId("");
    setDisplayName("");
    setNearAccountId(defaultNearAccountId);
    setEventTypes([emptyEventType()]);
  };

  const sourceIdFormatError =
    sourceId.length > 0 && !SOURCE_ID_PATTERN.test(sourceId)
      ? "Use lowercase letters and numbers, separated by single dots, dashes, or underscores."
      : null;

  const hasDraftDefaults = Boolean(defaults?.sourceId || defaults?.displayName);
  const showDetails =
    !onImportProject || isEditing || isManualEntry || hasDraftDefaults || importedProject !== null;

  const eventTypeNames = eventTypes.map(({ name }) => name.trim());
  const nearAccount = nearAccountId.trim();
  const submitBlocker = (() => {
    if (!sourceId.trim()) return "Add a Source ID.";
    if (sourceIdFormatError) return "Fix the Source ID format.";
    if (!displayName.trim()) return "Add a display name.";
    if (!nearAccount) return "Add the NEAR account that will sign.";
    if (!isEditing && ownedAccountIds !== undefined) {
      if (ownedAccountIds.length === 0) {
        return "Link a NEAR account to your profile to register a source.";
      }
      if (!ownedAccountIds.includes(nearAccount)) {
        return `Sign in with ${nearAccount} to register this source.`;
      }
    }
    if (fieldErrors.sourceId || fieldErrors.nearAccountId) {
      return "Fix the highlighted field to continue.";
    }
    if (eventTypes.length === 0) return "Add at least one event type.";
    if (eventTypeNames.some((name) => !name)) return "Name every event type.";
    if (eventTypeNames.some((name) => !EVENT_TYPE_NAME_PATTERN.test(name))) {
      return "Use lowercase letters and numbers in event type names, separated by dots, dashes, or underscores.";
    }
    if (new Set(eventTypeNames).size !== eventTypeNames.length) {
      return "Give every event type a different name.";
    }
    if (eventTypes.some(({ pointValue }) => !Number.isInteger(pointValue) || pointValue < 0)) {
      return "Points must be whole numbers, 0 or more.";
    }
    return null;
  })();

  const form = (
    <form className="space-y-8" onSubmit={handleSubmit}>
      {onImportProject && !isEditing && (
        <div className="space-y-2">
          <Label htmlFor="project-reference">Find your project on nearbuilders.org</Label>
          {importedProject ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <ProjectMark title={importedProject.title} logoUrl={importedProjectLogo} />
              <div className="min-w-0 flex-1">
                <a
                  href={importedProject.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:underline"
                >
                  <span className="truncate">{importedProject.title}</span>
                  <ArrowSquareOut className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {ownerSignInAccountId
                    ? `Owned by ${ownerSignInAccountId}. That account signs the on-chain link.`
                    : "Details filled in below. You can still edit them."}
                </p>
              </div>
              {ownerSignInAccountId ? null : (
                <span className="hidden shrink-0 rounded-full border border-brand-accent/40 bg-brand-accent/10 px-2 py-0.5 text-xs font-medium text-foreground sm:inline">
                  Owned
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setImportedProject(null);
                  setImportedProjectLogo(null);
                  setProjectOwnerAccountId(null);
                  setProjectReference("");
                  setIsManualEntry(false);
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
                  value={projectReference}
                  autoComplete="off"
                  aria-describedby="project-reference-hint"
                  onChange={(event) => {
                    setProjectReference(event.target.value);
                    setImportError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const [onlyResult] = searchResults ?? [];
                      if (searchResults?.length === 1 && onlyResult) void selectProject(onlyResult);
                      else if (!onSearchProjects || isProjectLink(projectReference))
                        void importProject();
                    }
                    if (event.key === "Escape") setSearchResults(null);
                  }}
                  placeholder={
                    onSearchProjects
                      ? "Search by project name, or paste its link"
                      : "https://nearbuilders.org/projects/your-project"
                  }
                  className="h-11 bg-background pr-10 pl-9"
                />
                {(isSearching || isImporting) && (
                  <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
                )}
                {searchResults && (
                  <ul
                    aria-label="Matching nearbuilders.org projects"
                    className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-elevation-md"
                  >
                    {searchResults.length === 0 ? (
                      <li className="px-3 py-3 text-sm text-muted-foreground">
                        No projects match. Check the name, paste the project's link, or enter the
                        details manually.
                      </li>
                    ) : (
                      [...searchResults]
                        .sort((a, b) => Number(isOwnedProject(b)) - Number(isOwnedProject(a)))
                        .map((result) => (
                          <li key={result.id}>
                            <button
                              type="button"
                              disabled={isImporting}
                              onClick={() => void selectProject(result)}
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
                              {isOwnedProject(result) && (
                                <span className="shrink-0 rounded-full border border-brand-accent/40 bg-brand-accent/10 px-2 py-0.5 text-xs font-medium text-foreground">
                                  Owned
                                </span>
                              )}
                            </button>
                          </li>
                        ))
                    )}
                  </ul>
                )}
              </div>
              {(!onSearchProjects || isProjectLink(projectReference)) && (
                <Button
                  type="button"
                  className="h-11"
                  onClick={() => void importProject()}
                  disabled={isImporting || !projectReference.trim()}
                >
                  {isImporting ? "Filling…" : "Fill from project"}
                </Button>
              )}
              {!showDetails && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setIsManualEntry(true)}
                >
                  <PencilSimple />
                  Enter manually
                </Button>
              )}
            </div>
          )}
          {importError && (
            <p id="project-reference-hint" className="text-xs text-destructive">
              {importError}
            </p>
          )}
        </div>
      )}
      {showDetails && (
        <>
          <fieldset className="space-y-4">
            <legend className="mb-4 text-sm font-semibold text-foreground">
              About your source
            </legend>
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <FormField
                label="Source ID"
                htmlFor="source-id"
                description={
                  isEditing
                    ? "Permanent, so it cannot be changed."
                    : "Permanent and public on every event. It cannot be changed later."
                }
                error={sourceIdFormatError ?? fieldErrors.sourceId}
              >
                <Input
                  id="source-id"
                  name="sourceId"
                  value={sourceId}
                  readOnly={isEditing}
                  aria-invalid={Boolean(sourceIdFormatError ?? fieldErrors.sourceId)}
                  onChange={(event) => {
                    setSourceId(event.target.value);
                    setFieldErrors(({ sourceId: _, ...rest }) => rest);
                  }}
                  placeholder="near-catalog"
                  className="bg-background"
                  required
                />
              </FormField>
              <FormField
                label="Display name"
                htmlFor="display-name"
                description="Shown on feed cards. You can change it later."
              >
                <Input
                  id="display-name"
                  name="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="NEAR Catalog"
                  className="bg-background"
                  required
                />
              </FormField>
              <FormField
                label="NEAR account"
                htmlFor="near-account-id"
                description={
                  ownerSignInAccountId ? (
                    <>
                      Sign in with the project owner's NEAR account:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {ownerSignInAccountId}
                      </span>
                    </>
                  ) : (
                    "Signs the on-chain link. One NEAR account can own up to 10 sources."
                  )
                }
                error={fieldErrors.nearAccountId}
              >
                <Input
                  id="near-account-id"
                  name="nearAccountId"
                  value={nearAccountId}
                  aria-invalid={Boolean(fieldErrors.nearAccountId)}
                  onChange={(event) => {
                    setNearAccountId(event.target.value);
                    setFieldErrors(({ nearAccountId: _, ...rest }) => rest);
                  }}
                  placeholder="catalog.near"
                  className="bg-background"
                  required
                />
              </FormField>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <div className="space-y-1">
              <legend className="text-sm font-semibold text-foreground">Event types</legend>
              <p className="text-xs text-muted-foreground">
                The kinds of action you report, such as{" "}
                <span className="font-mono">feedback.submitted</span>. Events of any other type are
                rejected with a 400.
              </p>
            </div>

            <div className="space-y-3">
              {eventTypes.map((eventType, index) => (
                <div
                  key={`event-type-${index.toString()}`}
                  className="space-y-4 rounded-lg border border-border bg-background p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Event type {index + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <Label
                        htmlFor={`event-type-enabled-${index.toString()}`}
                        className="flex items-center gap-2 px-2 text-xs font-normal"
                      >
                        <Checkbox
                          id={`event-type-enabled-${index.toString()}`}
                          checked={eventType.enabled}
                          onCheckedChange={(checked) =>
                            updateEventType(index, { enabled: checked === true })
                          }
                        />
                        Enabled
                      </Label>
                      {eventTypes.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Remove event type ${index + 1}`}
                          onClick={() =>
                            setEventTypes((current) =>
                              current.filter((_, eventTypeIndex) => eventTypeIndex !== index),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_8rem] sm:items-start">
                    <FormField label="Name" htmlFor={`event-type-name-${index.toString()}`}>
                      <Input
                        id={`event-type-name-${index.toString()}`}
                        value={eventType.name}
                        onChange={(event) => updateEventType(index, { name: event.target.value })}
                        placeholder="catalog.project.published"
                        required
                      />
                    </FormField>
                    <FormField
                      label="Points"
                      htmlFor={`event-type-points-${index.toString()}`}
                      description="Per event. 0 scores nothing."
                    >
                      <Input
                        id={`event-type-points-${index.toString()}`}
                        type="number"
                        min={0}
                        step={1}
                        value={eventType.pointValue}
                        onChange={(event) =>
                          updateEventType(index, { pointValue: Number(event.target.value) })
                        }
                        required
                      />
                    </FormField>
                  </div>
                  <FormField
                    label="Description (optional)"
                    htmlFor={`event-type-description-${index.toString()}`}
                  >
                    <Input
                      id={`event-type-description-${index.toString()}`}
                      value={eventType.description}
                      onChange={(event) =>
                        updateEventType(index, { description: event.target.value })
                      }
                      placeholder="A project was published"
                    />
                  </FormField>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setEventTypes((current) => [...current, emptyEventType()])}
            >
              <Plus />
              Add event type
            </Button>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-end">
            {submitBlocker && (
              <p
                id="registration-blocker"
                className="text-xs text-muted-foreground sm:mr-auto"
                aria-live="polite"
              >
                {submitBlocker}
              </p>
            )}
            {onCancel && (
              <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={isSubmitting || Boolean(submitBlocker)}
              aria-describedby={submitBlocker ? "registration-blocker" : undefined}
            >
              {isEditing ? "Save changes" : "Register source"}
            </Button>
          </div>
        </>
      )}
    </form>
  );

  if (embedded) return form;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Register Activity Source</h2>
      <Card className="p-5 sm:p-6">{form}</Card>
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        description && <FieldDescription className="text-xs">{description}</FieldDescription>
      )}
    </div>
  );
}
