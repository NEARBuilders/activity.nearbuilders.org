import { Copy, KeyRound, Link2, RefreshCw, RotateCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  ActivitySigningIdentityView,
  ActivitySourceApiKeyView,
} from "@/components/activity-sources-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ActivitySourceCredentialsProps {
  sourceId: string;
  nearAccountId: string;
  identity: ActivitySigningIdentityView | null;
  apiKeys: ActivitySourceApiKeyView[];
  revealedApiKey?: { secret: string; apiKeyId: string } | null;
  isSubmitting: boolean;
  onCreateIdentity: () => void | Promise<void>;
  onBind: () => void | Promise<void>;
  onConfirmBinding: () => void | Promise<void>;
  onRotate: () => void | Promise<void>;
  onCreateApiKey: (name: string) => void | Promise<void>;
  onRevokeApiKey: (apiKeyId: string) => void | Promise<void>;
  onDismissReveal?: () => void;
}

export function ActivitySourceCredentials({
  sourceId,
  nearAccountId,
  identity,
  apiKeys,
  revealedApiKey,
  isSubmitting,
  onCreateIdentity,
  onBind,
  onConfirmBinding,
  onRotate,
  onCreateApiKey,
  onRevokeApiKey,
  onDismissReveal,
}: ActivitySourceCredentialsProps) {
  const [apiKeyName, setApiKeyName] = useState("");

  const createApiKey = async () => {
    const name = apiKeyName.trim();
    if (!name) return;
    await onCreateApiKey(name);
    setApiKeyName("");
  };

  const copySecret = async () => {
    if (!revealedApiKey) return;
    try {
      await navigator.clipboard.writeText(revealedApiKey.secret);
      toast.success("Source API Key copied");
    } catch {
      toast.error("Failed to copy Source API Key");
    }
  };

  return (
    <div className="mt-5 space-y-4 border-t border-border pt-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <ShieldCheck className="size-4" />
        Gateway credentials
      </div>

      {!identity ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Create an encrypted Nostr identity for {sourceId}. Only its public key is shown.
          </p>
          <Button type="button" size="sm" onClick={onCreateIdentity} disabled={isSubmitting}>
            <KeyRound />
            Create Signing Identity
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {identity.bindingStatus === "bound" ? "NEAR bound" : "Binding required"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Master key {identity.keyVersion}
              </span>
            </div>
            <p className="break-all font-mono text-xs text-foreground">{identity.publicKey}</p>
          </div>

          {identity.bindingStatus === "pending" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Connect {nearAccountId}, authorize the binding transaction, then check it after the
                transaction is indexed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={onBind} disabled={isSubmitting}>
                  <Link2 />
                  Authorize with NEAR
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onConfirmBinding}
                  disabled={isSubmitting}
                >
                  <RefreshCw />
                  Check binding
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`api-key-name-${sourceId}`}>Source API Key name</Label>
                  <Input
                    id={`api-key-name-${sourceId}`}
                    value={apiKeyName}
                    onChange={(event) => setApiKeyName(event.target.value)}
                    placeholder="Production gateway"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="self-end"
                  onClick={createApiKey}
                  disabled={isSubmitting || apiKeyName.trim().length === 0}
                >
                  Create Source API Key
                </Button>
              </div>

              {revealedApiKey && (
                <div className="space-y-2 rounded-lg bg-muted p-3">
                  <p className="text-xs font-medium text-foreground">
                    Copy this secret now. It will not be shown again.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <Input readOnly value={revealedApiKey.secret} className="font-mono text-xs" />
                    <Button type="button" size="sm" variant="outline" onClick={copySecret}>
                      <Copy />
                      Copy
                    </Button>
                    {onDismissReveal && (
                      <Button type="button" size="sm" variant="outline" onClick={onDismissReveal}>
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {apiKeys.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No Source API Keys yet.</p>
                ) : (
                  apiKeys.map((apiKey) => (
                    <div
                      key={apiKey.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">{apiKey.name}</div>
                        <div className="flex flex-wrap gap-2 font-mono text-muted-foreground">
                          <span>{apiKey.prefix}</span>
                          <span>{apiKey.permissions[0]}</span>
                          {apiKey.revokedAt && <span>revoked</span>}
                        </div>
                      </div>
                      {!apiKey.revokedAt && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onRevokeApiKey(apiKey.id)}
                          disabled={isSubmitting}
                          aria-label={`Revoke ${apiKey.name}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRotate}
            disabled={isSubmitting}
          >
            <RotateCw />
            Rotate identity
          </Button>
        </div>
      )}
    </div>
  );
}
