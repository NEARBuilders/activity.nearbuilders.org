import { type ReactNode, useState } from "react";
import { ActivityEventTypesEditor, emptyEventType } from "@/components/activity-event-types-editor";
import { ActivityFormField } from "@/components/activity-form-field";
import {
  ActivityProjectSearch,
  type ActivityProjectSearchResult,
} from "@/components/activity-project-search";
import type {
  ActivityEventTypeView,
  CreateActivitySourceInput,
} from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export interface ActivityProjectImport {
  project: { id: string; title: string; url: string };
  sourceId?: string;
  displayName: string;
  nearAccountId?: string;
}

type RegistrationField = "sourceId" | "nearAccountId";

function fieldForError(error: unknown): RegistrationField | "project" | null {
  const field =
    typeof error === "object" && error !== null && "data" in error
      ? (error.data as { field?: unknown } | undefined)?.field
      : undefined;
  return field === "sourceId" || field === "nearAccountId" || field === "project" ? field : null;
}

interface ImportedProject {
  project: ActivityProjectImport["project"];
  logoUrl: string | null;
  ownerAccountId: string | null;
}

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
  const [imported, setImported] = useState<ImportedProject | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [searchKey, setSearchKey] = useState(0);

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

  const importProject = async (reference: string, logoUrl: string | null = null) => {
    if (!onImportProject || !reference) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const result = await onImportProject(reference);
      if (result.sourceId) setSourceId(result.sourceId);
      setDisplayName(result.displayName);
      if (result.nearAccountId) setNearAccountId(result.nearAccountId);
      setImported({
        project: result.project,
        logoUrl,
        ownerAccountId: result.nearAccountId ?? null,
      });
      setFieldErrors({});
    } catch (error) {
      setImported(null);
      setImportError(error instanceof Error ? error.message : "Could not import that project");
    } finally {
      setIsImporting(false);
    }
  };

  const signedInAccountIds = ownedAccountIds ?? [];
  const ownerSignInAccountId =
    imported?.ownerAccountId &&
    nearAccountId.trim() === imported.ownerAccountId &&
    !signedInAccountIds.includes(imported.ownerAccountId)
      ? imported.ownerAccountId
      : null;

  const hasDraftDefaults = Boolean(defaults?.sourceId || defaults?.displayName);
  const showDetails =
    !onImportProject || isEditing || isManualEntry || hasDraftDefaults || imported !== null;

  const sourceIdFormatError =
    sourceId.length > 0 && !SOURCE_ID_PATTERN.test(sourceId)
      ? "Use lowercase letters and numbers, separated by single dots, dashes, or underscores."
      : null;

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitBlocker) return;
    const nearbuildersProjectId = isEditing
      ? undefined
      : (imported?.project.id ?? defaults?.nearbuildersProjectId);
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
      const field = fieldForError(error);
      if (field === "project") setImportError(message);
      else if (field) setFieldErrors({ [field]: message });
      return;
    }
    setFieldErrors({});
    if (isEditing) return;
    setImported(null);
    setSearchKey((key) => key + 1);
    setSourceId("");
    setDisplayName("");
    setNearAccountId(defaultNearAccountId);
    setEventTypes([emptyEventType()]);
  };

  const form = (
    <form className="space-y-8" onSubmit={handleSubmit}>
      {onImportProject && !isEditing && (
        <ActivityProjectSearch
          key={searchKey}
          selected={
            imported
              ? {
                  title: imported.project.title,
                  url: imported.project.url,
                  logoUrl: imported.logoUrl,
                  ownerSignInAccountId,
                }
              : null
          }
          isImporting={isImporting}
          error={importError}
          ownedAccountIds={signedInAccountIds}
          onSearch={onSearchProjects}
          onImport={(reference, logoUrl) => void importProject(reference, logoUrl ?? null)}
          onClear={() => {
            setImported(null);
            setIsManualEntry(false);
          }}
          onQueryChange={() => setImportError(null)}
          onEnterManually={showDetails ? undefined : () => setIsManualEntry(true)}
        />
      )}
      {showDetails && (
        <>
          <fieldset className="space-y-4">
            <legend className="mb-4 text-sm font-semibold text-foreground">
              About your source
            </legend>
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <ActivityFormField
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
              </ActivityFormField>
              <ActivityFormField
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
              </ActivityFormField>
              <ActivityFormField
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
              </ActivityFormField>
            </div>
          </fieldset>

          <ActivityEventTypesEditor eventTypes={eventTypes} onChange={setEventTypes} />

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
