import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg",
        compact ? "border border-dashed border-border px-6 py-10" : "min-h-[55vh] py-16",
        className,
      )}
    >
      <div className="max-w-md text-center space-y-3">
        {Icon && (
          <div className="flex min-h-[40px] items-center justify-center">
            <Icon size={compact ? 28 : 40} className="text-muted-foreground" />
          </div>
        )}
        {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
        {description && (
          <div className="min-h-[1.25rem] text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
