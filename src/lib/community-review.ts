import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const communityInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("review"), name: text(1, 60), body: text(10, 1500), rating: z.number().int().min(1).max(5), consent: z.literal(true), website: z.literal("").default("") }).strict(),
  z.object({ kind: z.literal("idea"), name: text(1, 60), body: text(10, 1500), rating: z.null(), consent: z.literal(false), website: z.literal("").default("") }).strict(),
]);
export type CommunityInput = z.infer<typeof communityInput>;
export type PublicReview = { id: string; name: string; body: string; rating: number; created_at: string };
export type CommunitySummary = { count: number; average: number | null; reviews: PublicReview[] };
export const reviewRules = (identity: string) => [
  { key: `reviews:${identity}:day`, limit: 3, seconds: 86400 },
  { key: "reviews:site:hour", limit: 100, seconds: 3600 },
];
