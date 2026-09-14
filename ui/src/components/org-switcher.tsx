import {
  BuildingsIcon as Building2,
  CheckIcon as Check,
  CaretUpDownIcon as ChevronsUpDown,
  PlusIcon as Plus,
} from "@phosphor-icons/react/ssr";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Organization } from "@/app";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface OrgSwitcherProps {
  organizations: Organization[];
  activeOrgId?: string | null;
  onSwitch: (orgId: string) => void | Promise<void>;
}

export function OrgSwitcher({ organizations, activeOrgId, onSwitch }: OrgSwitcherProps) {
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrgId) return;
    try {
      await onSwitch(orgId);
    } catch (switchError) {
      toast.error(
        switchError instanceof Error
          ? switchError.message
          : "Failed to confirm the selected workspace",
      );
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-32 justify-start gap-2 sm:w-44">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate min-w-0 flex-1 text-left">
            {activeOrg?.name ?? "Workspace"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            className="flex items-center justify-between cursor-pointer"
            onClick={() => handleSwitch(org.id)}
          >
            <span className="truncate min-w-0 flex-1">{org.name}</span>
            {org.id === activeOrgId && <Check className="h-3.5 w-3.5 text-brand-accent" />}
          </DropdownMenuItem>
        ))}
        {organizations.length === 0 && (
          <DropdownMenuItem disabled className="text-muted-foreground">
            No organizations
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/organizations/new" className="flex items-center gap-2 cursor-pointer">
            <Plus className="h-3.5 w-3.5" />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
