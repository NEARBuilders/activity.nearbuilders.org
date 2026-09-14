import {
  EnvelopeIcon as Mail,
  ArrowsClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
} from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface OrganizationInvitation {
  email: string;
  role: string;
  expiresAt: string;
}

interface OrganizationInvitationCardProps {
  invitation: OrganizationInvitation;
  onResend?: () => void;
  onCancel?: () => void;
  isResending?: boolean;
  isCancelling?: boolean;
}

export function OrganizationInvitationCard({
  invitation,
  onResend,
  onCancel,
  isResending,
  isCancelling,
}: OrganizationInvitationCardProps) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="break-all text-sm font-medium">{invitation.email}</div>
          </div>
          <div className="font-mono text-xs text-muted-foreground">{invitation.role}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          {onResend && (
            <Button onClick={onResend} disabled={isResending} variant="outline" size="sm">
              <RefreshCw className="h-3 w-3 mr-1" />
              Resend
            </Button>
          )}
          {onCancel && (
            <Button
              onClick={onCancel}
              disabled={isCancelling}
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Expires {new Date(invitation.expiresAt).toLocaleString()}
      </div>
    </Card>
  );
}
