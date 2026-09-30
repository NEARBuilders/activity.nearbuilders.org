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
    try {
      await onCreate({ sourceId, displayName, nearAccountId, eventTypes });
    } catch {
      return;
    }
    setSourceId("");
    setDisplayName("");
    setNearAccountId(defaultNearAccountId);
    setEventTypes([emptyEventType()]);
  };

  const form = (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          label="Source ID"
          htmlFor="source-id"
          description="Lowercase, permanent, and shown publicly on every event. It cannot be changed later."
        >
          <Input
            id="source-id"
            name="sourceId"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="near-catalog"
            required
          />
        </FormField>
        <FormField
          label="Display name"
          htmlFor="display-name"
          description="Shown on feed cards. This one can be changed later."
        >
          <Input
            id="display-name"
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="NEAR Catalog"
            required
          />
        </FormField>
        <FormField
          label="NEAR account"
          htmlFor="near-account-id"
          description="The exact mainnet account that will sign the binding transaction. A different account cannot complete the binding."
        >
          <Input
            id="near-account-id"
            name="nearAccountId"
            value={nearAccountId}
            onChange={(event) => setNearAccountId(event.target.value)}
            placeholder="catalog.near"
            required
          />
        </FormField>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Declared event types</h3>
            <p className="text-xs text-muted-foreground">
              An event type is a kind of action you report, such as{" "}
              <span className="font-mono">feedback.submitted</span>. Declare every type you expect
              to publish: submitting a type that is missing or disabled returns a 400. Names must be
              lowercase and unique within this source.
            </p>
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
        </div>

        <div className="space-y-3">
          {eventTypes.map((eventType, index) => (
            <div
              key={`event-type-${index.toString()}`}
              className="grid gap-3 border-t border-border py-4 md:grid-cols-[1fr_1.5fr_8rem_auto_auto] md:items-end"
            >
              <FormField label="Name" htmlFor={`event-type-name-${index.toString()}`}>
                <Input
                  id={`event-type-name-${index.toString()}`}
                  value={eventType.name}
                  onChange={(event) => updateEventType(index, { name: event.target.value })}
                  placeholder="catalog.project.published"
                  required
                />
              </FormField>
              <FormField label="Description" htmlFor={`event-type-description-${index.toString()}`}>
                <Input
                  id={`event-type-description-${index.toString()}`}
                  value={eventType.description}
                  onChange={(event) => updateEventType(index, { description: event.target.value })}
                  placeholder="A project was published"
                  required
                />
              </FormField>
              <FormField
                label="Points"
                htmlFor={`event-type-points-${index.toString()}`}
                description="Score added per event. 0 means events of this type score nothing."
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
              <Label
                htmlFor={`event-type-enabled-${index.toString()}`}
                className="flex h-10 items-center gap-2 font-normal"
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove event type ${index + 1}`}
                disabled={eventTypes.length === 1}
                onClick={() =>
                  setEventTypes((current) =>
                    current.filter((_, eventTypeIndex) => eventTypeIndex !== index),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
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
      <Card className="p-5">{form}</Card>
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
    </div>
  );
}
