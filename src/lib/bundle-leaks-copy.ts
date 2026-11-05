import type { SecretKind } from "@/lib/secrets";

/** Types and plain-language copy for the live leak check, safe to import from client components. */
export type LeakKind = SecretKind | "supabase-service-role" | "openai-key" | "anthropic-key" | "stripe-test-secret";
export type Leak = { kind: LeakKind; severity: "critical" | "warning"; file: string; masked: string };
export type PublicKey = { kind: "stripe-publishable" | "supabase-anon" | "supabase-publishable"; file: string };
export type LeakReport = { url: string; host: string; files: number; bytes: number; leaks: Leak[]; publicKeys: PublicKey[]; partial: boolean };

/** What each finding means and what to do, in plain words. */
export const LEAK_COPY: Record<LeakKind, { name: string; fix: string }> = {
  "stripe-secret": { name: "Stripe live secret key", fix: "Roll the key in Stripe (Developers, API keys) now, then keep it in a server-only variable without NEXT_PUBLIC_ or VITE_." },
  "stripe-restricted": { name: "Stripe restricted key", fix: "Roll it in Stripe now and only use it from server code." },
  "stripe-webhook": { name: "Stripe webhook signing secret", fix: "Roll the endpoint's signing secret in Stripe and read it only in your webhook route." },
  "stripe-test-secret": { name: "Stripe test secret key", fix: "No real money, but anyone can use your test account. Move it to a server-only variable and roll it." },
  "aws-access-key": { name: "AWS access key", fix: "Deactivate the key in AWS IAM now, check CloudTrail for use, and call AWS only from the server." },
  "github-token": { name: "GitHub token", fix: "Revoke the token in GitHub settings now. Never send it to the browser." },
  "supabase-secret": { name: "Supabase secret key", fix: "Rotate it in Supabase (Project Settings, API keys). It bypasses Row Level Security, so it must stay on the server." },
  "supabase-service-role": { name: "Supabase service_role key", fix: "Anyone can read and write every table with it, RLS or not. Rotate the JWT secret or move to new API keys in Supabase, and never prefix it with NEXT_PUBLIC_ or VITE_." },
  "private-key": { name: "Private key", fix: "Replace the key pair, and keep the private key in a server-only variable." },
  "openai-key": { name: "OpenAI API key", fix: "Delete the key in the OpenAI dashboard now: bots look for these and spend your credit. Call OpenAI from a server route instead." },
  "anthropic-key": { name: "Anthropic API key", fix: "Delete the key in the Anthropic console now and call the API from a server route instead." },
};
