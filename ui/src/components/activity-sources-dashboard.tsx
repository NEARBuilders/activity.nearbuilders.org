import { RadioTower } from "lucide-react";
import type { ReactNode } from "react";
import { ActivitySourceCard, ActivitySourceReviewCard } from "@/components/activity-source-cards";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";
import type {
  ActivitySourceView,
  CreateActivitySourceInput,
  ReviewActivitySourceInput,
} from "@/components/activity-sources-model";
import { Card } from "@/components/ui/card";
import type { ActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

export type {
  ActivityEventTypeView,
  ActivitySourceView,
  CreateActivitySourceInput,
  ReviewActivitySourceInput,
} from "@/components/activity-sources-model";

interface ActivitySourcesDashboardProps {
  sources: ActivitySourceView[];
  reviewQueue: ActivitySourceView[];
  isAdmin: boolean;
  registrationAccess: ActivitySourceRegistrationAccess;
  isSubmitting: boolean;
  onCreate: (input: CreateActivitySourceInput) => void | Promise<void>;
  onReview: (input: ReviewActivitySourceInput) => void | Promise<void>;
  renderCredentials?: (source: ActivitySourceView) => ReactNode;
}

export function ActivitySourcesDashboard({
  sources,
  reviewQueue,
  isAdmin,
  registrationAccess,
  isSubmitting,
  onCreate,
  onReview,
  renderCredentials,
}: ActivitySourcesDashboardProps) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <RadioTower className="h-3 w-3" />
          Activity protocol
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Activity Sources
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Register the NEAR accounts and event types that may publish activity for your
          organization.
        </p>
      </header>

      <ActivitySourceRegistration
        access={registrationAccess}
        isSubmitting={isSubmitting}
        onCreate={onCreate}
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Your sources</h2>
          <span className="text-xs text-muted-foreground">{sources.length} registered</span>
        </div>
        {sources.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No Activity Sources are registered for this organization.
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {sources.map((source) => (
              <ActivitySourceCard
                key={source.sourceId}
                source={source}
                credentials={renderCredentials?.(source)}
              />
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Source review queue</h2>
            <span className="text-xs text-muted-foreground">{reviewQueue.length} pending</span>
          </div>
          {reviewQueue.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No sources are awaiting review.
            </Card>
          ) : (
            <div className="space-y-4">
              {reviewQueue.map((source) => (
                <ActivitySourceReviewCard
                  key={source.sourceId}
                  source={source}
                  isSubmitting={isSubmitting}
                  onReview={onReview}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
