-- Migrate the Shift enum from a 3-shift model to a 2-shift model.
--
-- Background
-- ----------
-- The OCC runs two 12-hour shifts, not three. The schema was originally
-- built around `Shift { Morning, Afternoon, Night }`. This migration drops
-- the `Afternoon` value so the enum becomes `Shift { Morning, Night }`,
-- matching the rest of the stack (Prisma schema, backend Zod, dashboard /
-- carry-forward services, frontend types, seeds, and the shared docs).
--
-- Reseed-clean decision
-- ---------------------
-- The current Supabase data is dev/pilot only. Per the approved migration
-- plan there is no per-row backfill: any existing `Afternoon` handovers are
-- disposable and deleted here. Do NOT run this against a database whose
-- Afternoon rows must be preserved.
--
-- Why the rename dance
-- --------------------
-- PostgreSQL cannot DROP a value from an enum type that is still in use by a
-- column. The supported pattern is to rename the old type, create the new
-- type, retype the column with a USING cast, then drop the old type. Only
-- `Handover.shift` references this enum, so it is the only column retyped.

-- Drop disposable Afternoon rows before retyping the column.
DELETE FROM "Handover" WHERE "shift" = 'Afternoon';

ALTER TYPE "public"."Shift" RENAME TO "Shift_old";

CREATE TYPE "public"."Shift" AS ENUM ('Morning', 'Night');

ALTER TABLE "Handover"
  ALTER COLUMN "shift" TYPE "public"."Shift"
  USING ("shift"::text::"public"."Shift");

DROP TYPE "public"."Shift_old";
