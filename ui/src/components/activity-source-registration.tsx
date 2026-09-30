import { PlusIcon as Plus, TrashIcon as Trash2 } from "@phosphor-icons/react/ssr";
import { type ReactNode, useState } from "react";
import type {
  ActivityEventTypeView,
  CreateActivitySourceInput,
} from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
}: {
  access: ActivitySourceRegistrationAccess | null;
  isSubmitting: boolean;
  onCreate: (input: CreateActivitySourceInput) => void | Promise<void>;
  registrationAction?: ReactNode;
  embedded?: boolean;
  defaultNearAccountId?: string;
}) {
  const [sourceId, setSourceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nearAccountId, setNearAccountId] = useState(defaultNearAccountId);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const [eventTypes, setEventTypes] = useState<ActivityEventTypeView[]>([emptyEventType()]);

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

  const updateEventType = (index: number, update: Partial<ActivityEventTypeView>) => {
    setEventTypes((current) =>
      current.map((eventType, eventTypeIndex) =>
        eventTypeIndex === index ? { ...eventType, ...update } : eventType,
      ),
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sourceIdFormatError) return;
    try {
      await onCreate({ sourceId, displayName, nearAccountId, eventTypes });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const field = fieldForError(message);
      if (field) setFieldErrors({ [field]: message });
      return;
    }
    setFieldErrors({});
    setSourceId("");
    setDisplayName("");
    setNearAccountId(defaultNearAccountId);
    setEventTypes([emptyEventType()]);
  };

  const sourceIdFormatError =
    sourceId.length > 0 && !SOURCE_ID_PATTERN.test(sourceId)
      ? "Use lowercase letters and numbers, separated by single dots, dashes, or underscores."
      : null;

  const form = (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <fieldset className="space-y-4">
        <legend className="mb-4 text-sm font-semibold text-foreground">About your source</legend>
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <FormField
            label="Source ID"
            htmlFor="source-id"
            description="Permanent and public on every event. It cannot be changed later."
            error={sourceIdFormatError ?? fieldErrors.sourceId}
          >
            <Input
              id="source-id"
              name="sourceId"
              value={sourceId}
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
            description="Signs the on-chain link. Each NEAR account can own only one source."
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
              <FormField label="Description" htmlFor={`event-type-description-${index.toString()}`}>
                <Input
                  id={`event-type-description-${index.toString()}`}
                  value={eventType.description}
                  onChange={(event) => updateEventType(index, { description: event.target.value })}
                  placeholder="A project was published"
                  required
                />
              </FormField>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEventTypes((current) => [...current, emptyEventType()])}
        >
          <Plus />
          Add event type
        </Button>
      </fieldset>

      <div className="flex justify-end border-t border-border pt-6">
        <Button type="submit" disabled={isSubmitting}>
          Register source
        </Button>
      </div>
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
  description?: string;
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
