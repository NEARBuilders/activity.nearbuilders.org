import type { ReactNode } from "react";
import { FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";

export function ActivityFormField({
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
  children: ReactNode;
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
