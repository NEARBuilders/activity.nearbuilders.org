import { z } from "zod";

export const ProfileSchema = z.object({
  pubkey: z.string(),
  name: z.string().optional().nullable(),
  picture: z.string().optional().nullable(),
  about: z.string().optional().nullable(),
  nip05: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
});
export type NostrProfile = z.infer<typeof ProfileSchema>;

export const CommentProfileSchema = z.object({
  name: z.string().optional().nullable(),
  picture: z.string().optional().nullable(),
  about: z.string().optional().nullable(),
  nip05: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
});
export type CommentProfile = z.infer<typeof CommentProfileSchema>;

export const NostrCommentSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  content: z.string(),
  target: z.string(),
  targetType: z.string(),
  nearAccountId: z.string().optional().nullable(),
  parentEventId: z.string().optional().nullable(),
  rootEventId: z.string().optional().nullable(),
  createdAt: z.number().int(),
  tags: z.array(z.array(z.string())).optional(),
  source: z.enum(["standard", "buzz"]),
  profile: CommentProfileSchema.optional().nullable(),
});
export type NostrComment = z.infer<typeof NostrCommentSchema>;

export const RelayStatusSchema = z.object({
  relay: z.string(),
  success: z.boolean(),
});
export type RelayStatus = z.infer<typeof RelayStatusSchema>;

export const PublishResultSchema = z.object({
  eventId: z.string(),
  statuses: z.array(RelayStatusSchema),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

export const ChannelInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional().nullable(),
  members: z.number().int().optional().nullable(),
});
export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;

export const NostrEventSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  pubkey: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.number().int().min(0),
  kind: z.number().int().min(0).max(65535),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[a-f0-9]{128}$/),
});

export const NostrFilterSchema = z.object({
  kinds: z.array(z.number().int().min(0).max(65535)).min(1).optional(),
  authors: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .optional(),
  ids: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .optional(),
  since: z.number().int().min(0).optional(),
  until: z.number().int().min(0).optional(),
  limit: z.number().int().min(0).max(1000).optional(),
  tags: z
    .array(z.object({ tag: z.string().regex(/^[a-zA-Z]$/), values: z.array(z.string()).min(1) }))
    .optional(),
});

export const RawRelayInputSchema = z.object({
  filter: NostrFilterSchema,
  relays: z.array(z.string()).min(1).max(10).optional(),
});
