import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { type Organization, type SessionData, useAuthClient } from "@/app";
import type { ApiKeyFormValues, ApiKeyRevealProps } from "@/components/api-key-manager";
import { synchronizeActiveOrganization } from "@/lib/active-organization";

type AuthClientType = import("@/app").AuthClient;

type MembersResponse = Awaited<ReturnType<AuthClientType["organization"]["listMembers"]>>;
export type OrganizationMemberItem = NonNullable<MembersResponse["data"]>["members"][number];

type InvitationsResponse = Awaited<ReturnType<AuthClientType["organization"]["listInvitations"]>>;
export type OrganizationInvitationItem = NonNullable<InvitationsResponse["data"]>[number];

export type OrganizationApiKey = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string | Date;
  expiresAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

type CreatedApiKey = ApiKeyRevealProps["apiKey"];

const orgMembersQueryKey = (orgId: string) => ["org-members", orgId] as const;
const orgInvitationsQueryKey = (orgId: string) => ["org-invitations", orgId] as const;
const orgApiKeysQueryKey = (orgId: string) => ["org-api-keys", orgId] as const;

export function useOrganizationDetail(orgSlug: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const auth = useAuthClient();

  const { data: session } = useQuery<SessionData | null>({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await auth.getSession();
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
  });

  const organization = organizations.find((item: Organization) => item.slug === orgSlug);
  const organizationId = organization?.id ?? "";

  const members =
    useQuery({
      queryKey: orgMembersQueryKey(organizationId),
      queryFn: async (): Promise<OrganizationMemberItem[]> => {
        const { data, error } = await auth.organization.listMembers({
          query: { organizationId },
        });
        if (error) throw new Error(error.message);
        return (data?.members ?? []) as OrganizationMemberItem[];
      },
      enabled: !!organizationId,
    }).data ?? [];

  const invitations =
    useQuery({
      queryKey: orgInvitationsQueryKey(organizationId),
      queryFn: async (): Promise<OrganizationInvitationItem[]> => {
        const { data, error } = await auth.organization.listInvitations({
          query: { organizationId },
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as OrganizationInvitationItem[];
      },
      enabled: !!organizationId,
    }).data ?? [];

  const apiKeys =
    useQuery({
      queryKey: orgApiKeysQueryKey(organizationId),
      queryFn: async (): Promise<OrganizationApiKey[]> => {
        const { data, error } = await auth.apiKey.list({
          query: { configId: "org-keys", organizationId },
        });
        if (error) throw new Error(error.message);
        return (data?.apiKeys ?? []) as OrganizationApiKey[];
      },
      enabled: !!organizationId,
    }).data ?? [];

  const membership = members.find((member) => member.userId === session?.user?.id);
  const canManageMembers = membership?.role === "owner" || membership?.role === "admin";
  const isOwner = membership?.role === "owner";
  const isActive = organizationId === session?.session?.activeOrganizationId;
  const isPersonal = session?.user
    ? organization?.slug === session.user.id ||
      (organization?.metadata as { isPersonal?: boolean } | null | undefined)?.isPersonal === true
    : false;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const switchOrganization = useMutation({
    mutationFn: async () =>
      synchronizeActiveOrganization({
        organizationId,
        queryClient,
        setActiveOrganization: async () => {
          const { error } = await auth.organization.setActive({ organizationId });
          if (error) throw new Error(error.message);
        },
        confirmActiveOrganization: async () => {
          const { data, error } = await auth.getSession({
            query: { disableCookieCache: true },
          });
          if (error) throw new Error(error.message);
          return data?.session.activeOrganizationId ?? null;
        },
        invalidateRouter: () => router.invalidate(),
      }),
    onSuccess: () => toast.success("Switched to this organization"),
    onError: (error: Error) => toast.error(error.message || "Failed to switch organization"),
  });

  const inviteMember = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.inviteMember({
        organizationId,
        email: inviteEmail,
        role: inviteRole,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to send invitation"),
  });

  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await auth.organization.cancelInvitation({ invitationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Invitation cancelled");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to cancel invitation"),
  });

  const resendInvitation = useMutation({
    mutationFn: async (invitation: OrganizationInvitationItem) => {
      const { error } = await auth.organization.inviteMember({
        organizationId,
        email: invitation.email,
        role: invitation.role as "admin" | "member" | "owner",
        resend: true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Invitation resent");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to resend invitation"),
  });

  const createApiKey = useMutation({
    mutationFn: async (values: ApiKeyFormValues) => {
      const { data, error } = await auth.apiKey.create({
        configId: "org-keys",
        organizationId,
        name: values.name,
        ...(values.expiresIn !== undefined ? { expiresIn: values.expiresIn } : {}),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (data) => {
      if (data) setCreatedApiKey(data as CreatedApiKey);
      toast.success("API key created");
      await queryClient.invalidateQueries({ queryKey: orgApiKeysQueryKey(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create API key"),
  });

  const deleteApiKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await auth.apiKey.delete({ keyId, configId: "org-keys" });
      if (error) throw new Error(error.message);
    },
    onMutate: async (keyId) => {
      await queryClient.cancelQueries({ queryKey: orgApiKeysQueryKey(organizationId) });
      const previousKeys = queryClient.getQueryData<OrganizationApiKey[]>(
        orgApiKeysQueryKey(organizationId),
      );
      queryClient.setQueryData<OrganizationApiKey[]>(
        orgApiKeysQueryKey(organizationId),
        (current) => current?.filter((key) => key.id !== keyId),
      );
      return { previousKeys };
    },
    onSuccess: async () => {
      toast.success("API key deleted");
      await queryClient.invalidateQueries({ queryKey: orgApiKeysQueryKey(organizationId) });
    },
    onError: (error: Error, _keyId, context) => {
      if (context?.previousKeys) {
        queryClient.setQueryData(orgApiKeysQueryKey(organizationId), context.previousKeys);
      }
      toast.error(error.message || "Failed to delete API key");
    },
  });

  const removeMember = useMutation({
    mutationFn: async (member: OrganizationMemberItem) => {
      const { error } = await auth.organization.removeMember({
        memberIdOrEmail: member.user?.email ?? member.userId,
        organizationId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Member removed");
      await queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to remove member"),
  });

  const updateOrganization = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const { error } = await auth.organization.update({
        organizationId,
        data: { name, slug },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setIsEditing(false);
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update organization"),
  });

  const leaveOrganization = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.leave({ organizationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("You have left the organization");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/organizations" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to leave organization"),
  });

  const deleteOrganization = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.delete({ organizationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization deleted");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/organizations" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete organization"),
  });

  const beginEditing = () => {
    if (!organization) return;
    setEditName(organization.name);
    setEditSlug(organization.slug);
    setIsEditing(true);
  };

  const copyApiKey = async (value: string, message = "API key copied") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Failed to copy API key");
    }
  };

  return {
    apiKeys,
    canManageMembers,
    createdApiKey,
    editName,
    editSlug,
    invitations,
    inviteEmail,
    inviteRole,
    isActive,
    isEditing,
    isLoading,
    isOwner,
    isPersonal,
    membershipUserId: session?.user?.id,
    members,
    organization,
    pendingInvitations: invitations.filter((invitation) => invitation.status === "pending"),
    beginEditing,
    cancelEditing: () => setIsEditing(false),
    cancelInvitation,
    copyApiKey,
    createApiKey,
    deleteApiKey,
    deleteOrganization,
    dismissCreatedApiKey: () => setCreatedApiKey(null),
    inviteMember,
    leaveOrganization,
    removeMember,
    resendInvitation,
    setEditName,
    setEditSlug,
    setInviteEmail,
    setInviteRole,
    switchOrganization,
    updateOrganization,
  };
}
