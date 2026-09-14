import {
  BuildingsIcon as Building2,
  PencilSimpleIcon as Edit2,
  KeyIcon as Key,
  SignOutIcon as LogOut,
  EnvelopeIcon as Mail,
  TrashIcon as Trash2,
  UsersIcon as Users,
} from "@phosphor-icons/react/ssr";
import { Link } from "@tanstack/react-router";
import { ApiKeyForm, ApiKeyReveal } from "@/components/api-key-manager";
import { EmptyState as SharedEmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { OrganizationInvitationCard } from "@/components/organizations/organization-invitation-card";
import { OrganizationMemberCard } from "@/components/organizations/organization-member-card";
import { useOrganizationDetail } from "@/components/organizations/use-organization-detail";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function OrganizationDetailPage({ orgSlug }: { orgSlug: string }) {
  const detail = useOrganizationDetail(orgSlug);

  if (detail.isLoading) {
    return (
      <PageContainer variant="wide">
        <div className="flex flex-col items-center justify-center min-h-[40vh]">
          <p className="text-sm text-muted-foreground">Loading organization...</p>
        </div>
      </PageContainer>
    );
  }

  if (!detail.organization) {
    return (
      <PageContainer variant="wide">
        <SharedEmptyState
          icon={Building2}
          title="Organization not found"
          description="This organization does not exist or you do not have access."
          action={
            <Button asChild variant="outline">
              <Link to="/organizations">back to organizations</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const organization = detail.organization;

  return (
    <PageContainer variant="wide">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Users className="h-3 w-3" />
            <Link to="/organizations" className="hover:text-foreground transition-colors">
              Organizations
            </Link>
            <span>/</span>
            <span className="text-foreground">{organization.slug}</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {organization.name}
            </h1>
          </div>
        </header>

        <section className="space-y-4 border-t border-border py-6">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>organization</Chip>
            {detail.isActive && <Chip accent>active</Chip>}
            {detail.isPersonal && <Chip>personal</Chip>}
          </div>
          <div className="flex flex-col gap-2">
            <InfoRow label="members" value={String(detail.members.length)} />
            <InfoRow label="invites" value={String(detail.pendingInvitations.length)} />
            <InfoRow label="api keys" value={String(detail.apiKeys.length)} />
            {organization.createdAt && (
              <InfoRow
                label="created"
                value={new Date(organization.createdAt).toLocaleDateString()}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!detail.isActive && (
              <Button
                onClick={() => detail.switchOrganization.mutate()}
                disabled={detail.switchOrganization.isPending}
              >
                {detail.switchOrganization.isPending ? "switching..." : "switch to org"}
              </Button>
            )}
            {detail.isOwner && !detail.isPersonal && (
              <Button variant="outline" onClick={detail.beginEditing}>
                <Edit2 className="h-3.5 w-3.5" />
                edit
              </Button>
            )}
            {!detail.isPersonal && !detail.isOwner && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm(`Leave "${organization.name}"?`)) {
                    detail.leaveOrganization.mutate();
                  }
                }}
                disabled={detail.leaveOrganization.isPending}
              >
                <LogOut className="h-3.5 w-3.5" />
                {detail.leaveOrganization.isPending ? "leaving..." : "leave"}
              </Button>
            )}
            {detail.isOwner && !detail.isPersonal && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm(`Delete "${organization.name}"? This cannot be undone.`)) {
                    detail.deleteOrganization.mutate();
                  }
                }}
                disabled={detail.deleteOrganization.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {detail.deleteOrganization.isPending ? "deleting..." : "delete org"}
              </Button>
            )}
          </div>
        </section>

        {detail.isEditing && detail.isOwner && (
          <section className="space-y-4 border-t border-border py-6">
            <div className="text-sm font-medium text-muted-foreground">Edit Organization</div>
            <div className="flex flex-col">
              <Input
                type="text"
                value={detail.editName}
                onChange={(event) => detail.setEditName(event.target.value)}
                placeholder="Organization name"
              />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">@</span>
                <Input
                  type="text"
                  value={detail.editSlug}
                  onChange={(event) =>
                    detail.setEditSlug(event.target.value.replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="slug"
                  pattern="[a-z0-9-]+"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  detail.updateOrganization.mutate({
                    name: detail.editName,
                    slug: detail.editSlug,
                  })
                }
                disabled={
                  detail.updateOrganization.isPending || !detail.editName || !detail.editSlug
                }
              >
                {detail.updateOrganization.isPending ? "saving..." : "save"}
              </Button>
              <Button onClick={detail.cancelEditing} variant="outline">
                cancel
              </Button>
            </div>
          </section>
        )}

        <Tabs defaultValue="members" className="w-full min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="members" className="shrink-0">
              <Users className="h-4 w-4 mr-1.5" />
              Members ({detail.members.length})
            </TabsTrigger>
            <TabsTrigger value="invitations" className="shrink-0">
              <Mail className="h-4 w-4 mr-1.5" />
              Invitations ({detail.pendingInvitations.length})
            </TabsTrigger>
            <TabsTrigger value="apikeys" className="shrink-0">
              <Key className="h-4 w-4 mr-1.5" />
              API Keys ({detail.apiKeys.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-6 pt-4">
            {detail.members.length > 0 ? (
              <div className="flex flex-col">
                {detail.members.map((member) => (
                  <OrganizationMemberCard
                    key={member.id}
                    member={member}
                    canManage={detail.canManageMembers && member.userId !== detail.membershipUserId}
                    onRemove={() => detail.removeMember.mutate(member)}
                    isRemoving={detail.removeMember.isPending}
                  />
                ))}
              </div>
            ) : (
              <EmptyState label="No members found" />
            )}
          </TabsContent>

          <TabsContent value="invitations" className="space-y-6 pt-4">
            {detail.canManageMembers && !detail.isPersonal && (
              <section className="space-y-4 border-t border-border py-6">
                <div className="text-sm font-medium text-muted-foreground">Invite member</div>
                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <Input
                    type="email"
                    value={detail.inviteEmail}
                    onChange={(event) => detail.setInviteEmail(event.target.value)}
                    placeholder="email@example.com"
                  />
                  <Select
                    value={detail.inviteRole}
                    onValueChange={(role) => {
                      if (role === "admin" || role === "member") detail.setInviteRole(role);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => detail.inviteMember.mutate()}
                  disabled={detail.inviteMember.isPending || !detail.inviteEmail}
                  variant="outline"
                >
                  {detail.inviteMember.isPending ? "sending..." : "send invitation"}
                </Button>
              </section>
            )}

            {detail.pendingInvitations.length > 0 ? (
              <div className="flex flex-col">
                {detail.pendingInvitations.map((invitation) => (
                  <OrganizationInvitationCard
                    key={invitation.id}
                    invitation={invitation}
                    onCancel={
                      detail.canManageMembers
                        ? () => detail.cancelInvitation.mutate(invitation.id)
                        : undefined
                    }
                    onResend={
                      detail.canManageMembers
                        ? () => detail.resendInvitation.mutate(invitation)
                        : undefined
                    }
                    isCancelling={detail.cancelInvitation.isPending}
                    isResending={detail.resendInvitation.isPending}
                  />
                ))}
              </div>
            ) : (
              <EmptyState label="No pending invitations" />
            )}
          </TabsContent>

          <TabsContent value="apikeys" className="space-y-6 pt-4">
            {detail.canManageMembers && (
              <section className=" border-t border-border py-6">
                <ApiKeyForm
                  onCreate={(values) => detail.createApiKey.mutate(values)}
                  isPending={detail.createApiKey.isPending}
                />
              </section>
            )}

            {detail.createdApiKey && (
              <ApiKeyReveal apiKey={detail.createdApiKey} onDismiss={detail.dismissCreatedApiKey} />
            )}

            {detail.apiKeys.length > 0 ? (
              <div className="flex flex-col">
                {detail.apiKeys.map((key) => (
                  <section key={key.id} className="space-y-3 border-t border-border py-6">
                    <div className="space-y-1 min-w-0">
                      <div className="font-medium text-foreground break-all">
                        {key.name ?? "unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {key.prefix ?? "api_"}...{key.start ?? ""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <div>created {new Date(key.createdAt).toLocaleString()}</div>
                      {key.expiresAt && (
                        <div>expires {new Date(key.expiresAt).toLocaleString()}</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => detail.copyApiKey(key.start || "", "Key prefix copied")}
                        variant="outline"
                      >
                        copy id
                      </Button>
                      {detail.canManageMembers && (
                        <Button
                          onClick={() => detail.deleteApiKey.mutate(key.id)}
                          disabled={detail.deleteApiKey.isPending}
                          variant="outline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          delete
                        </Button>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState label="No API keys" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] px-2.5 py-0.5 text-[11px] font-semibold border ${accent ? "bg-brand-accent-light border-brand-accent-border" : "bg-secondary border-border"} text-foreground`}
    >
      {children}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <section className="text-center text-sm text-muted-foreground border-t border-border py-6">
      {label}
    </section>
  );
}
