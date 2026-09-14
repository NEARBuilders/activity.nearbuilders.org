import { TrashIcon as Trash2 } from "@phosphor-icons/react/ssr";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getInitials } from "@/lib/utils";

export interface OrganizationMember {
  id: string;
  userId: string;
  role: string;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

interface OrganizationMemberCardProps {
  member: OrganizationMember;
  canManage: boolean;
  onRemove?: () => void;
  isRemoving?: boolean;
}

export function OrganizationMemberCard({
  member,
  canManage,
  onRemove,
  isRemoving,
}: OrganizationMemberCardProps) {
  const user = member.user;

  const displayName = user?.name || user?.email || member.userId;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            {user?.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-0.5">
            <div className="truncate text-sm font-medium">{displayName}</div>
            {user?.email && user.name && (
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            )}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {member.role}
        </Badge>
      </div>

      {canManage && onRemove && (
        <Button
          onClick={onRemove}
          disabled={isRemoving}
          variant="outline"
          size="sm"
          className="self-start text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          {isRemoving ? "Removing…" : "Remove"}
        </Button>
      )}
    </Card>
  );
}
