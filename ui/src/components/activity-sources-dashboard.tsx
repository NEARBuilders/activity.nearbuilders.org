import { BroadcastIcon, GavelIcon, ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { ActivitySourceCard, ActivitySourceReviewCard } from "@/components/activity-source-cards";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";
import type {
  ActivitySourceView,
  CreateActivitySourceInput,
  ReviewActivitySourceInput,
  UpdateActivitySourceTrustInput,
} from "@/components/activity-sources-model";
import { EmptyState } from "@/components/empty-state";
import { ActivitySourceTrustCard } from "@/components/ui/activity-source-trust-card";
import type { ActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

export type {
  ActivityEventTypeView,
  ActivitySourceView,
  CreateActivitySourceInput,
  ReviewActivitySourceInput,
  UpdateActivitySourceTrustInput,
} from "@/components/activity-sources-model";

interface ActivitySourcesDashboardProps {
  sources: ActivitySourceView[];
  reviewQueue: ActivitySourceView[];
  adminSources: ActivitySourceView[];
  isAdmin: boolean;
  registrationAccess: ActivitySourceRegistrationAccess;
  isSubmitting: boolean;
  onCreate: (input: CreateActivitySourceInput) => void | Promise<void>;
  onReview: (input: ReviewActivitySourceInput) => void | Promise<void>;
  onTrust: (input: UpdateActivitySourceTrustInput) => void | Promise<void>;
  renderCredentials?: (source: ActivitySourceView) => ReactNode;
}

export function ActivitySourcesDashboard({
  sources,
  reviewQueue,
  adminSources,
  isAdmin,
  registrationAccess,
  isSubmitting,
  onCreate,
  onReview,
  onTrust,
  renderCredentials,
}: ActivitySourcesDashboardProps) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Activity Sources</h1>
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
          <EmptyState
            compact
            icon={BroadcastIcon}
            title="No Activity Sources yet"
            description="Register a source above to start publishing events for this organization."
          />
        ) : (
          <div className="flex flex-col gap-4">
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
            <EmptyState
              compact
              icon={GavelIcon}
              title="Nothing to review"
              description="No sources are awaiting review."
            />
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

      {isAdmin && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Source trust controls</h2>
            <span className="text-xs text-muted-foreground">{adminSources.length} sources</span>
          </div>
          {adminSources.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldCheckIcon}
              title="Nothing to configure"
              description="No sources are available for trust configuration."
            />
          ) : (
            <div className="space-y-4">
              {adminSources.map((source) => (
                <ActivitySourceTrustCard
                  key={source.sourceId}
                  source={source}
                  isSubmitting={isSubmitting}
                  onTrust={onTrust}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
