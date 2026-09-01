import type { InferContractRouterInputs, InferContractRouterOutputs } from "@orpc/contract";
import { z } from "every-plugin/zod";
export declare const apiKeySchema: z.ZodObject<{
    id: z.ZodString;
    configId: z.ZodString;
    referenceId: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    prefix: z.ZodNullable<z.ZodString>;
    start: z.ZodNullable<z.ZodString>;
    enabled: z.ZodBoolean;
    rateLimitEnabled: z.ZodBoolean;
    rateLimitMax: z.ZodNullable<z.ZodNumber>;
    rateLimitTimeWindow: z.ZodNullable<z.ZodNumber>;
    remaining: z.ZodNullable<z.ZodNumber>;
    requestCount: z.ZodNumber;
    lastRequest: z.ZodNullable<z.ZodDate>;
    expiresAt: z.ZodNullable<z.ZodDate>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
    metadata: z.ZodNullable<z.ZodUnknown>;
    permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
export declare const contract: {
    health: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        status: z.ZodLiteral<"ok">;
        timestamp: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    getSession: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        session: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            token: z.ZodString;
            userId: z.ZodString;
            expiresAt: z.ZodDate;
            activeOrganizationId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        user: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            email: z.ZodString;
            emailVerified: z.ZodBoolean;
            image: z.ZodNullable<z.ZodString>;
            role: z.ZodNullable<z.ZodString>;
            isAnonymous: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getContext: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        user: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            email: z.ZodString;
            emailVerified: z.ZodBoolean;
            image: z.ZodNullable<z.ZodString>;
            role: z.ZodNullable<z.ZodString>;
            isAnonymous: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        userId: z.ZodNullable<z.ZodString>;
        isAuthenticated: z.ZodBoolean;
        authMethod: z.ZodEnum<{
            session: "session";
            anonymous: "anonymous";
            apiKey: "apiKey";
            none: "none";
        }>;
        principal: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"user">;
            userId: z.ZodString;
            user: z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                email: z.ZodString;
                emailVerified: z.ZodBoolean;
                image: z.ZodNullable<z.ZodString>;
                role: z.ZodNullable<z.ZodString>;
                isAnonymous: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"organization">;
            organizationId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"anonymous">;
            userId: z.ZodString;
            user: z.ZodNullable<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                email: z.ZodString;
                emailVerified: z.ZodBoolean;
                image: z.ZodNullable<z.ZodString>;
                role: z.ZodNullable<z.ZodString>;
                isAnonymous: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>;
        apiKey: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
        }, z.core.$strip>>;
        near: z.ZodObject<{
            primaryAccountId: z.ZodNullable<z.ZodString>;
            linkedAccounts: z.ZodArray<z.ZodObject<{
                accountId: z.ZodString;
                network: z.ZodString;
                publicKey: z.ZodString;
                isPrimary: z.ZodBoolean;
            }, z.core.$strip>>;
            hasNearAccount: z.ZodBoolean;
        }, z.core.$strip>;
        organization: z.ZodObject<{
            activeOrganizationId: z.ZodNullable<z.ZodString>;
            organization: z.ZodNullable<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                slug: z.ZodString;
                logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>;
            member: z.ZodNullable<z.ZodObject<{
                id: z.ZodString;
                role: z.ZodString;
            }, z.core.$strip>>;
            isPersonal: z.ZodBoolean;
            hasOrganization: z.ZodBoolean;
        }, z.core.$strip>;
        organizations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            role: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            slug: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getActiveMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodNullable<z.ZodString>;
        role: z.ZodNullable<z.ZodString>;
        organizationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listOrganizations: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        metadata: z.ZodNullable<z.ZodUnknown>;
        createdAt: z.ZodDate;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getFullOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
        organizationSlug: z.ZodOptional<z.ZodString>;
        membersLimit: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        metadata: z.ZodNullable<z.ZodUnknown>;
        createdAt: z.ZodDate;
        members: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            organizationId: z.ZodString;
            role: z.ZodString;
            createdAt: z.ZodDate;
        }, z.core.$strip>>;
        invitations: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            organizationId: z.ZodString;
            email: z.ZodString;
            role: z.ZodNullable<z.ZodString>;
            status: z.ZodString;
            expiresAt: z.ZodDate;
            inviterId: z.ZodString;
        }, z.core.$strip>>;
        teams: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            organizationId: z.ZodString;
            createdAt: z.ZodDate;
            updatedAt: z.ZodDate;
        }, z.core.$strip>>>;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    createOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        name: z.ZodString;
        slug: z.ZodString;
        logo: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        createdAt: z.ZodDate;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    setActiveOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    updateOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        data: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            slug: z.ZodOptional<z.ZodString>;
            logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    leaveOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    deleteOrganization: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    checkSlug: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        slug: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    hasPermission: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
        permissions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    linkDao: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodString;
        daoAccountId: z.ZodString;
        daoNetwork: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    unlinkDao: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getDao: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        daoAccountId: z.ZodNullable<z.ZodString>;
        daoNetwork: z.ZodNullable<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getActiveMemberRole: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        role: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listMembers: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        offset: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        members: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            organizationId: z.ZodString;
            role: z.ZodString;
            createdAt: z.ZodDate;
            user: z.ZodNullable<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodNullable<z.ZodString>;
                email: z.ZodNullable<z.ZodString>;
                image: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        total: z.ZodNumber;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    addMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        userId: z.ZodString;
        role: z.ZodEnum<{
            member: "member";
            owner: "owner";
            admin: "admin";
        }>;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        userId: z.ZodString;
        organizationId: z.ZodString;
        role: z.ZodString;
        createdAt: z.ZodDate;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    removeMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        memberIdOrEmail: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    updateMemberRole: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        role: z.ZodEnum<{
            member: "member";
            owner: "owner";
            admin: "admin";
        }>;
        memberId: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        userId: z.ZodString;
        organizationId: z.ZodString;
        role: z.ZodString;
        createdAt: z.ZodDate;
        user: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            email: z.ZodNullable<z.ZodString>;
            image: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    inviteMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        email: z.ZodString;
        role: z.ZodEnum<{
            member: "member";
            owner: "owner";
            admin: "admin";
        }>;
        organizationId: z.ZodOptional<z.ZodString>;
        resend: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        email: z.ZodString;
        role: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        expiresAt: z.ZodDate;
        inviterId: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getInvitation: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        email: z.ZodString;
        role: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        expiresAt: z.ZodDate;
        inviterId: z.ZodString;
        organizationName: z.ZodString;
        organizationSlug: z.ZodString;
        inviterEmail: z.ZodString;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listInvitations: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        email: z.ZodString;
        role: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        expiresAt: z.ZodDate;
        inviterId: z.ZodString;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listUserInvitations: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        email: z.ZodString;
        role: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        expiresAt: z.ZodDate;
        inviterId: z.ZodString;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    cancelInvitation: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        invitationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    acceptInvitation: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        invitationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    rejectInvitation: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        invitationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    createTeam: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        name: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        organizationId: z.ZodString;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    updateTeam: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        teamId: z.ZodString;
        data: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        organizationId: z.ZodString;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    deleteTeam: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        teamId: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listTeams: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        organizationId: z.ZodString;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listTeamMembers: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        teamId: z.ZodString;
    }, z.core.$strip>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        userId: z.ZodString;
        createdAt: z.ZodDate;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    addTeamMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        teamId: z.ZodString;
        userId: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        userId: z.ZodString;
        createdAt: z.ZodDate;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    removeTeamMember: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        teamId: z.ZodString;
        userId: z.ZodString;
        organizationId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listApiKeys: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        offset: z.ZodOptional<z.ZodNumber>;
        sortBy: z.ZodOptional<z.ZodEnum<{
            name: "name";
            expiresAt: "expiresAt";
            lastRequest: "lastRequest";
            createdAt: "createdAt";
        }>>;
        sortDirection: z.ZodOptional<z.ZodEnum<{
            asc: "asc";
            desc: "desc";
        }>>;
    }, z.core.$strip>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        configId: z.ZodString;
        referenceId: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        prefix: z.ZodNullable<z.ZodString>;
        start: z.ZodNullable<z.ZodString>;
        enabled: z.ZodBoolean;
        rateLimitEnabled: z.ZodBoolean;
        rateLimitMax: z.ZodNullable<z.ZodNumber>;
        rateLimitTimeWindow: z.ZodNullable<z.ZodNumber>;
        remaining: z.ZodNullable<z.ZodNumber>;
        requestCount: z.ZodNumber;
        lastRequest: z.ZodNullable<z.ZodDate>;
        expiresAt: z.ZodNullable<z.ZodDate>;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
        metadata: z.ZodNullable<z.ZodUnknown>;
        permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    createApiKey: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        prefix: z.ZodOptional<z.ZodString>;
        expiresIn: z.ZodOptional<z.ZodNumber>;
        permissions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
        metadata: z.ZodOptional<z.ZodUnknown>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            timeWindow: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        organizationId: z.ZodOptional<z.ZodString>;
        configId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        configId: z.ZodString;
        referenceId: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        prefix: z.ZodNullable<z.ZodString>;
        start: z.ZodNullable<z.ZodString>;
        enabled: z.ZodBoolean;
        rateLimitEnabled: z.ZodBoolean;
        rateLimitMax: z.ZodNullable<z.ZodNumber>;
        rateLimitTimeWindow: z.ZodNullable<z.ZodNumber>;
        remaining: z.ZodNullable<z.ZodNumber>;
        requestCount: z.ZodNumber;
        lastRequest: z.ZodNullable<z.ZodDate>;
        expiresAt: z.ZodNullable<z.ZodDate>;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
        metadata: z.ZodNullable<z.ZodUnknown>;
        permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
        key: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    updateApiKey: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        enabled: z.ZodOptional<z.ZodBoolean>;
        permissions: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        metadata: z.ZodOptional<z.ZodUnknown>;
        expiresIn: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            timeWindow: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        configId: z.ZodString;
        referenceId: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        prefix: z.ZodNullable<z.ZodString>;
        start: z.ZodNullable<z.ZodString>;
        enabled: z.ZodBoolean;
        rateLimitEnabled: z.ZodBoolean;
        rateLimitMax: z.ZodNullable<z.ZodNumber>;
        rateLimitTimeWindow: z.ZodNullable<z.ZodNumber>;
        remaining: z.ZodNullable<z.ZodNumber>;
        requestCount: z.ZodNumber;
        lastRequest: z.ZodNullable<z.ZodDate>;
        expiresAt: z.ZodNullable<z.ZodDate>;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
        metadata: z.ZodNullable<z.ZodUnknown>;
        permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    deleteApiKey: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    verifyApiKey: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        key: z.ZodString;
        configId: z.ZodOptional<z.ZodString>;
        permissions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>, z.ZodObject<{
        valid: z.ZodBoolean;
        error: z.ZodNullable<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        key: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            configId: z.ZodString;
            referenceId: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            prefix: z.ZodNullable<z.ZodString>;
            start: z.ZodNullable<z.ZodString>;
            enabled: z.ZodBoolean;
            rateLimitEnabled: z.ZodBoolean;
            rateLimitMax: z.ZodNullable<z.ZodNumber>;
            rateLimitTimeWindow: z.ZodNullable<z.ZodNumber>;
            remaining: z.ZodNullable<z.ZodNumber>;
            requestCount: z.ZodNumber;
            lastRequest: z.ZodNullable<z.ZodDate>;
            expiresAt: z.ZodNullable<z.ZodDate>;
            createdAt: z.ZodDate;
            updatedAt: z.ZodDate;
            metadata: z.ZodNullable<z.ZodUnknown>;
            permissions: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearNonce: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodString;
        networkId: z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        nonce: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearVerify: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        signedMessage: z.ZodObject<{
            accountId: z.ZodString;
            publicKey: z.ZodString;
            signature: z.ZodString;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        message: z.ZodString;
        recipient: z.ZodString;
        nonce: z.ZodString;
        accountId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        token: z.ZodString;
        success: z.ZodLiteral<true>;
        user: z.ZodObject<{
            id: z.ZodString;
            accountId: z.ZodString;
            network: z.ZodEnum<{
                mainnet: "mainnet";
                testnet: "testnet";
            }>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearProfile: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
            ipfs_cid: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        backgroundImage: z.ZodOptional<z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
            ipfs_cid: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        linktree: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearLinkAccount: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        signedMessage: z.ZodObject<{
            accountId: z.ZodString;
            publicKey: z.ZodString;
            signature: z.ZodString;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        message: z.ZodString;
        recipient: z.ZodString;
        nonce: z.ZodString;
        accountId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
        accountId: z.ZodString;
        network: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearUnlinkAccount: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodString;
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
        accountId: z.ZodString;
        network: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearListAccounts: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        accounts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            accountId: z.ZodString;
            network: z.ZodString;
            publicKey: z.ZodString;
            providerId: z.ZodOptional<z.ZodLiteral<"siwn">>;
            isPrimary: z.ZodBoolean;
            isActive: z.ZodOptional<z.ZodBoolean>;
            isAvailable: z.ZodOptional<z.ZodBoolean>;
            createdAt: z.ZodDate;
        }, z.core.$strip>>;
        activeAccount: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            accountId: z.ZodString;
            network: z.ZodString;
            publicKey: z.ZodString;
            providerId: z.ZodOptional<z.ZodLiteral<"siwn">>;
            isPrimary: z.ZodBoolean;
            isActive: z.ZodOptional<z.ZodBoolean>;
            isAvailable: z.ZodOptional<z.ZodBoolean>;
            createdAt: z.ZodDate;
        }, z.core.$strip>>>;
        availableAccounts: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            accountId: z.ZodString;
            network: z.ZodString;
            publicKey: z.ZodString;
            providerId: z.ZodOptional<z.ZodLiteral<"siwn">>;
            isPrimary: z.ZodBoolean;
            isActive: z.ZodOptional<z.ZodBoolean>;
            isAvailable: z.ZodOptional<z.ZodBoolean>;
            createdAt: z.ZodDate;
        }, z.core.$strip>>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearRelay: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        payload: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        txHash: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearRelayStatus: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        txHash: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
        gasUsed: z.ZodOptional<z.ZodString>;
        outcome: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearRelayerInfo: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        enabled: z.ZodBoolean;
        accountId: z.ZodOptional<z.ZodString>;
        mode: z.ZodOptional<z.ZodEnum<{
            ephemeral: "ephemeral";
            explicit: "explicit";
        }>>;
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
        balance: z.ZodOptional<z.ZodString>;
        available: z.ZodOptional<z.ZodString>;
        staked: z.ZodOptional<z.ZodString>;
        storageUsage: z.ZodOptional<z.ZodString>;
        storageBytes: z.ZodOptional<z.ZodNumber>;
        hasContract: z.ZodOptional<z.ZodBoolean>;
        hasKey: z.ZodOptional<z.ZodBoolean>;
        publicKey: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodString>;
        lastUsedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearRelayHistory: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        transactions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            txHash: z.ZodString;
            senderId: z.ZodString;
            receiverId: z.ZodString;
            network: z.ZodString;
            status: z.ZodString;
            gasUsed: z.ZodOptional<z.ZodString>;
            createdAt: z.ZodString;
            updatedAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearView: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        contractId: z.ZodString;
        methodName: z.ZodString;
        args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>, z.ZodObject<{
        result: z.ZodUnknown;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearCheckSubAccountAvailability: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        subAccountName: z.ZodString;
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        available: z.ZodBoolean;
        accountId: z.ZodString;
        parentAccount: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodEnum<{
            taken: "taken";
            invalid: "invalid";
            "too-long": "too-long";
            "not-configured": "not-configured";
        }>>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    nearCreateSubAccount: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        subAccountName: z.ZodString;
        publicKey: z.ZodString;
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodBoolean;
        accountId: z.ZodString;
        txHash: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
};
export type ContractType = typeof contract;
export type InferOutput<K extends keyof InferContractRouterOutputs<ContractType>> = InferContractRouterOutputs<ContractType>[K];
export type InferInput<K extends keyof InferContractRouterInputs<ContractType>> = InferContractRouterInputs<ContractType>[K];
