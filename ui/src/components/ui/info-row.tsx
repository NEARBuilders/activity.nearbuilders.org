import type { ReactNode } from "react";

export function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-4 border-b border-border py-3 items-center">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-foreground text-[13px] break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
