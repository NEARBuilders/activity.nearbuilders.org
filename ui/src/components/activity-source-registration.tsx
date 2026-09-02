import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  ActivityEventTypeView,
  CreateActivitySourceInput,
} from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      "Choose an organization from the workspace menu before registering an Activity Source.",
  },
  "owner-required": {
    title: "Organization owner required",
    description: "Only an owner of the active organization can register an Activity Source.",
  },
  "near-required": {
    title: "Connect a NEAR account",
    description: "Authenticate with a NEAR account before registering an Activity Source.",
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
}: {
  access: ActivitySourceRegistrationAccess;
  isSubmitting: boolean;
  onCreate: (input: CreateActivitySourceInput) => void | Promise<void>;
}) {
  const [sourceId, setSourceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [eventTypes, setEventTypes] = useState<ActivityEventTypeView[]>([emptyEventType()]);

  if (access !== "allowed") {
    return (
      <Card className="p-6">
        <h2 className="font-semibold text-foreground">{registrationBlocker[access].title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {registrationBlocker[access].description}
        </p>
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
    setNearAccountId("");
    setEventTypes([emptyEventType()]);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Register Activity Source</h2>
      <Card className="p-5 sm:p-6">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Source ID" htmlFor="source-id">
              <Input
                id="source-id"
                name="sourceId"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                placeholder="near-catalog"
                required
              />
            </FormField>
            <FormField label="Display name" htmlFor="display-name">
              <Input
                id="display-name"
                name="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="NEAR Catalog"
                required
              />
            </FormField>
            <FormField label="NEAR account" htmlFor="near-account-id">
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
                  Names must be unique within this source.
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
                  className="grid gap-3 rounded-[10px] border border-border bg-muted/30 p-4 md:grid-cols-[1fr_1.5fr_8rem_auto_auto] md:items-end"
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
                  <FormField
                    label="Description"
                    htmlFor={`event-type-description-${index.toString()}`}
                  >
                    <Input
                      id={`event-type-description-${index.toString()}`}
                      value={eventType.description}
                      onChange={(event) =>
                        updateEventType(index, { description: event.target.value })
                      }
                      placeholder="A project was published"
                      required
                    />
                  </FormField>
                  <FormField label="Points" htmlFor={`event-type-points-${index.toString()}`}>
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
                  <label className="flex h-10 items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={eventType.enabled}
                      onChange={(event) =>
                        updateEventType(index, { enabled: event.target.checked })
                      }
                    />
                    Enabled
                  </label>
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
      </Card>
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
