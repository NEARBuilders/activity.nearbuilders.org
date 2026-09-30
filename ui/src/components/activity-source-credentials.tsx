import {
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  KeyIcon as Key,
  ArrowClockwiseIcon as RotateCw,
} from "@phosphor-icons/react/ssr";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type {
  ActivitySigningIdentityView,
  ActivitySourceApiKeyView,
} from "@/components/activity-sources-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string) {
  return dateFormat.format(new Date(value));
}

export function shortenKey(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Failed to copy ${label.toLowerCase()}`);
  }
}

export function ActivitySigningKeyPanel({
  nearAccountId,
  identity,
  isRotating,
  onRotate,
  linkAction,
}: {
  nearAccountId: string;
  identity: ActivitySigningIdentityView | null;
  isRotating: boolean;
  onRotate: () => void;
  linkAction: ReactNode;
}) {
  if (identity?.bindingStatus !== "bound") {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Not linked on-chain yet</p>
          <p className="text-sm text-muted-foreground">
            Approve one transaction from {nearAccountId} to prove this source belongs to it. API
            keys only work once the source is linked.
          </p>
        </div>
        {linkAction}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 size-5 shrink-0 text-brand-accent" weight="fill" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Linked on-chain to {identity.boundNearAccountId ?? nearAccountId}
          </p>
          <p className="text-sm text-muted-foreground">
            Activity signs every event from this source with this key. Its private half is encrypted
            and never leaves Activity.
            {identity.boundAt && ` Linked ${formatDate(identity.boundAt)}.`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Public key</span>
        <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {shortenKey(identity.publicKey)}
        </code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => copyToClipboard(identity.publicKey, "Public key")}
        >
          <Copy />
          Copy
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Rotate key</p>
          <p className="text-sm text-muted-foreground">
            Replace the key if you think it has been exposed. You approve one new transaction, and
            your API keys work again once it is linked.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
          onClick={onRotate}
          disabled={isRotating}
        >
          <RotateCw />
          {isRotating ? "Rotating..." : "Rotate key"}
        </Button>
      </div>
    </div>
  );
}

export function ActivityApiKeysPanel({
  apiKeys,
  isLinked,
  revealedApiKey,
  isSubmitting,
  onCreateApiKey,
  onRevokeApiKey,
  onDismissReveal,
}: {
  apiKeys: ActivitySourceApiKeyView[];
  isLinked: boolean;
  revealedApiKey: { secret: string; apiKeyId: string } | null;
  isSubmitting: boolean;
  onCreateApiKey: (name: string) => void | Promise<void>;
  onRevokeApiKey: (apiKeyId: string) => void | Promise<void>;
  onDismissReveal: () => void;
}) {
  const [name, setName] = useState("");
  const activeKeys = apiKeys.filter((apiKey) => !apiKey.revokedAt);
  const revokedKeys = apiKeys.filter((apiKey) => apiKey.revokedAt);

  if (!isLinked) {
    return (
      <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        Link the signing key on-chain first. API keys only work for a linked source.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {revealedApiKey && (
        <div className="space-y-3 rounded-lg border border-brand-accent/40 bg-brand-accent/5 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Copy your new key now</p>
            <p className="text-xs text-muted-foreground">
              It is not shown again. Store it in your server's secret manager.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input
              readOnly
              aria-label="New API key"
              value={revealedApiKey.secret}
              className="bg-background font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => copyToClipboard(revealedApiKey.secret, "API key")}
            >
              <Copy />
              Copy
            </Button>
            <Button type="button" onClick={onDismissReveal}>
              I saved it
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {activeKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active API keys.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {activeKeys.map((apiKey) => (
              <ApiKeyRow
                key={apiKey.id}
                apiKey={apiKey}
                isSubmitting={isSubmitting}
                onRevoke={onRevokeApiKey}
              />
            ))}
          </ul>
        )}
        {revokedKeys.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {revokedKeys.length} revoked {revokedKeys.length === 1 ? "key" : "keys"} hidden.
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          await onCreateApiKey(trimmed);
          setName("");
        }}
      >
        <div className="space-y-1.5 sm:w-72">
          <Label htmlFor="new-api-key-name">New key name</Label>
          <Input
            id="new-api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production"
          />
        </div>
        <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
          <Key />
          Create key
        </Button>
      </form>
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  isSubmitting,
  onRevoke,
}: {
  apiKey: ActivitySourceApiKeyView;
  isSubmitting: boolean;
  onRevoke: (apiKeyId: string) => void | Promise<void>;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-foreground">{apiKey.name}</span>
          <code className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</code>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatDate(apiKey.createdAt)} ·{" "}
          {apiKey.lastUsedAt ? `Last used ${formatDate(apiKey.lastUsedAt)}` : "Never used"}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onRevoke(apiKey.id)}
        disabled={isSubmitting}
        aria-label={`Revoke ${apiKey.name}`}
      >
        Revoke
      </Button>
    </li>
  );
}
