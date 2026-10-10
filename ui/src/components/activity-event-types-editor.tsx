import { PlusIcon as Plus, TrashIcon as Trash2 } from "@phosphor-icons/react/ssr";
import { ActivityFormField } from "@/components/activity-form-field";
import type { ActivityEventTypeView } from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const emptyEventType = (): ActivityEventTypeView => ({
  name: "",
  description: "",
  enabled: true,
  pointValue: 0,
});

export function ActivityEventTypesEditor({
  eventTypes,
  onChange,
}: {
  eventTypes: ActivityEventTypeView[];
  onChange: (eventTypes: ActivityEventTypeView[]) => void;
}) {
  const updateEventType = (index: number, update: Partial<ActivityEventTypeView>) => {
    onChange(
      eventTypes.map((eventType, eventTypeIndex) =>
        eventTypeIndex === index ? { ...eventType, ...update } : eventType,
      ),
    );
  };

  return (
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
                      onChange(eventTypes.filter((_, eventTypeIndex) => eventTypeIndex !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem] sm:items-start">
              <ActivityFormField label="Name" htmlFor={`event-type-name-${index.toString()}`}>
                <Input
                  id={`event-type-name-${index.toString()}`}
                  value={eventType.name}
                  onChange={(event) => updateEventType(index, { name: event.target.value })}
                  placeholder="catalog.project.published"
                  required
                />
              </ActivityFormField>
              <ActivityFormField
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
              </ActivityFormField>
            </div>
            <ActivityFormField
              label="Description (optional)"
              htmlFor={`event-type-description-${index.toString()}`}
            >
              <Input
                id={`event-type-description-${index.toString()}`}
                value={eventType.description}
                onChange={(event) => updateEventType(index, { description: event.target.value })}
                placeholder="A project was published"
              />
            </ActivityFormField>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        onClick={() => onChange([...eventTypes, emptyEventType()])}
      >
        <Plus />
        Add event type
      </Button>
    </fieldset>
  );
}
