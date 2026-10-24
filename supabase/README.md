# Shared database migration history

This Supabase project is shared by DeployDoctor and StayTag. DeployDoctor's Supabase GitHub integration
checks the complete project migration history, including the isolated StayTag tables.

`20261021184503_staytag_shared_moving_day.sql` is the original migration already applied to the shared
database on 2026-10-21. It was recovered verbatim from `supabase_migrations.schema_migrations`; it is
not a new production migration. Do not repair, delete, renumber or replay its existing history entry.
The file contains schema definitions only, without service credentials or customer data.

The `staytag_*` tables and RPC remain service-role only, with RLS enabled. Restoring this file allows
preview branches to reproduce the existing schema without moving data or coupling the two apps.

Keep migrations from both products in this canonical history while they share a database. Moving
StayTag into its own Supabase project is a separate migration and must preserve its live data.
