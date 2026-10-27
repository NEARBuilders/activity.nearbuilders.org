import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const contract: {
    listRelays: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        relays: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, object>;
    ping: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        status: z.ZodLiteral<"ok">;
        timestamp: z.ZodString;
    }, z.core.$strip>, object>;
    getBinding: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccountId: z.ZodString;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        npub: z.ZodString;
        relay: z.ZodString;
        proof: z.ZodString;
        boundAt: z.ZodNumber;
    }, z.core.$strip>>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    getIdentity: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccountId: z.ZodString;
        enrichProfile: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        nearAccountId: z.ZodString;
        nostrPubkey: z.ZodString;
        relay: z.ZodString;
        proof: z.ZodString;
        boundAt: z.ZodNumber;
        profile: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            pubkey: z.ZodString;
            name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            picture: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            about: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            nip05: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            website: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    createChallenge: import("@orpc/contract").ProcedureContract<z.ZodObject<{}, z.core.$strip>, z.ZodObject<{
        challenge: z.ZodString;
        expiresAt: z.ZodNumber;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>;
    verifyBinding: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        event: z.ZodObject<{
            id: z.ZodString;
            pubkey: z.ZodString;
            content: z.ZodString;
            tags: z.ZodArray<z.ZodArray<z.ZodString>>;
            created_at: z.ZodNumber;
            sig: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        valid: z.ZodBoolean;
        nearAccountId: z.ZodString;
        nostrPubkey: z.ZodString;
        proof: z.ZodString;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    prepareBindingWrite: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nostrPubkey: z.ZodString;
        relay: z.ZodString;
        proof: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        contractId: z.ZodString;
        methodName: z.ZodLiteral<"__fastdata_kv">;
        key: z.ZodString;
        value: z.ZodString;
        args: z.ZodRecord<z.ZodString, z.ZodString>;
        gas: z.ZodString;
        attachedDeposit: z.ZodString;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    listComments: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        target: z.ZodString;
        targetType: z.ZodDefault<z.ZodString>;
        adapterType: z.ZodOptional<z.ZodEnum<{
            buzz: "buzz";
            standard: "standard";
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
        since: z.ZodOptional<z.ZodNumber>;
        enrich: z.ZodOptional<z.ZodBoolean>;
        requireBound: z.ZodOptional<z.ZodBoolean>;
        requireVerified: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            pubkey: z.ZodString;
            content: z.ZodString;
            target: z.ZodString;
            targetType: z.ZodString;
            nearAccountId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            parentEventId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            rootEventId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            createdAt: z.ZodNumber;
            tags: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodString>>>;
            source: z.ZodEnum<{
                buzz: "buzz";
                standard: "standard";
            }>;
            profile: z.ZodNullable<z.ZodOptional<z.ZodObject<{
                name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
                picture: z.ZodNullable<z.ZodOptional<z.ZodString>>;
                about: z.ZodNullable<z.ZodOptional<z.ZodString>>;
                nip05: z.ZodNullable<z.ZodOptional<z.ZodString>>;
                website: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            count: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    createComment: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        event: z.ZodObject<{
            id: z.ZodString;
            pubkey: z.ZodString;
            kind: z.ZodDefault<z.ZodNumber>;
            content: z.ZodString;
            tags: z.ZodArray<z.ZodArray<z.ZodString>>;
            created_at: z.ZodNumber;
            sig: z.ZodString;
        }, z.core.$strip>;
        target: z.ZodString;
        targetType: z.ZodDefault<z.ZodString>;
        adapterType: z.ZodOptional<z.ZodEnum<{
            buzz: "buzz";
            standard: "standard";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        eventId: z.ZodString;
        statuses: z.ZodArray<z.ZodObject<{
            relay: z.ZodString;
            success: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    listChannels: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            members: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    queryEvents: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        filter: z.ZodObject<{
            kinds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
            ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
            since: z.ZodOptional<z.ZodNumber>;
            until: z.ZodOptional<z.ZodNumber>;
            limit: z.ZodOptional<z.ZodNumber>;
            tags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                tag: z.ZodString;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
        relays: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        events: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            pubkey: z.ZodString;
            created_at: z.ZodNumber;
            kind: z.ZodNumber;
            tags: z.ZodArray<z.ZodArray<z.ZodString>>;
            content: z.ZodString;
            sig: z.ZodString;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            limited: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        RELAY_UNAVAILABLE: {
            readonly status: 503;
            readonly message: "Relay unavailable";
        };
        RELAY_TIMEOUT: {
            readonly status: 504;
            readonly message: "Relay response timed out";
        };
        RELAY_LIMIT: {
            readonly status: 503;
            readonly message: "Relay replay or consumer buffer limit reached";
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    subscribeEvents: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        filter: z.ZodObject<{
            kinds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
            ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
            since: z.ZodOptional<z.ZodNumber>;
            until: z.ZodOptional<z.ZodNumber>;
            limit: z.ZodOptional<z.ZodNumber>;
            tags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                tag: z.ZodString;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
        relays: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        id: string;
        pubkey: string;
        created_at: number;
        kind: number;
        tags: string[][];
        content: string;
        sig: string;
    }, unknown, void>, import("@orpc/server").AsyncIteratorClass<{
        id: string;
        pubkey: string;
        created_at: number;
        kind: number;
        tags: string[][];
        content: string;
        sig: string;
    }, unknown, void>>, {
        RELAY_UNAVAILABLE: {
            readonly status: 503;
            readonly message: "Relay unavailable";
        };
        RELAY_TIMEOUT: {
            readonly status: 504;
            readonly message: "Relay response timed out";
        };
        RELAY_LIMIT: {
            readonly status: 503;
            readonly message: "Relay replay or consumer buffer limit reached";
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    publishEvent: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        event: z.ZodObject<{
            id: z.ZodString;
            pubkey: z.ZodString;
            created_at: z.ZodNumber;
            kind: z.ZodNumber;
            tags: z.ZodArray<z.ZodArray<z.ZodString>>;
            content: z.ZodString;
            sig: z.ZodString;
        }, z.core.$strip>;
        relays: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        eventId: z.ZodString;
        statuses: z.ZodArray<z.ZodObject<{
            relay: z.ZodString;
            success: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        RELAY_UNAVAILABLE: {
            readonly status: 503;
            readonly message: "Relay unavailable";
        };
        RELAY_TIMEOUT: {
            readonly status: 504;
            readonly message: "Relay response timed out";
        };
        RELAY_LIMIT: {
            readonly status: 503;
            readonly message: "Relay replay or consumer buffer limit reached";
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    getProfile: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        pubkey: z.ZodString;
    }, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        pubkey: z.ZodString;
        name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        picture: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        about: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        nip05: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        website: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    vaultPut: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nsec: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        createdAt: z.ZodString;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>;
    vaultGet: import("@orpc/contract").ProcedureContract<z.ZodObject<{}, z.core.$strip>, z.ZodNullable<z.ZodObject<{
        nsec: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>;
    vaultDelete: import("@orpc/contract").ProcedureContract<z.ZodObject<{}, z.core.$strip>, z.ZodObject<{
        deleted: z.ZodBoolean;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>;
};
export type ContractType = typeof contract;
