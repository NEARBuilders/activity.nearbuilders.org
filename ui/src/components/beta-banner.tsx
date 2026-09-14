import { XIcon as X } from "@phosphor-icons/react/ssr";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function BetaBanner() {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem("beta-banner-dismissed") === "true");
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2 sm:px-6">
      <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium">Beta</span>
      <p className="flex-1 text-xs text-muted-foreground">
        Data may be reset periodically. Keep a copy of anything important.
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss beta banner"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem("beta-banner-dismissed", "true");
          } catch {
            return;
          }
        }}
      >
        <X />
      </Button>
    </div>
  );
}
