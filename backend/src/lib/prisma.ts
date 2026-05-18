import { PrismaClient } from '@prisma/client'

type SoftDeleteArgs = {
  where?: Record<string, unknown>
} & Record<string, unknown>

/**
 * Inject `deletedAt: null` into a `where` clause so soft-deleted rows are
 * invisible to the operation. If the caller explicitly passed `deletedAt`,
 * their value wins (e.g. an archival script that purposely wants to look
 * at soft-deleted rows).
 */
function addDeletedAtFilter(args: SoftDeleteArgs | undefined): SoftDeleteArgs {
  const nextArgs = args ?? {}
  const existingWhere =
    nextArgs.where && typeof nextArgs.where === 'object'
      ? (nextArgs.where as Record<string, unknown>)
      : {}

  const nextWhere =
    'deletedAt' in existingWhere
      ? existingWhere
      : { ...existingWhere, deletedAt: null }

  return {
    ...nextArgs,
    where: nextWhere,
  }
}

function createPrismaClient() {
  const prisma = new PrismaClient()

  return prisma.$extends({
    query: {
      handover: createSoftDeleteQueries(),
      aircraftItem: createSoftDeleteQueries(),
      airportItem: createSoftDeleteQueries(),
      flightScheduleItem: createSoftDeleteQueries(),
      crewItem: createSoftDeleteQueries(),
      weatherItem: createSoftDeleteQueries(),
      systemItem: createSoftDeleteQueries(),
      abnormalEvent: createSoftDeleteQueries(),
    },
  })
}

function createSoftDeleteQueries() {
  return {
    // Reads — always hide soft-deleted rows by default.
    findMany({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },
    findFirst({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },
    count({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },
    aggregate({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },

    // Writes — refuse to touch a row that's already soft-deleted unless the
    // caller explicitly opts in by including `deletedAt` in `where`. This
    // closes the resurrection foot-gun where a service that only knows an
    // `id` would otherwise revive an archived row via
    // `update({ where: { id } })`.
    update({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },
    updateMany({ args, query }: { args?: SoftDeleteArgs; query: (args: SoftDeleteArgs) => Promise<unknown> }) {
      return query(addDeletedAtFilter(args))
    },

    // Note: `delete` / `deleteMany` are deliberately NOT extended here.
    //   - Production code MUST soft-delete by setting `deletedAt`; never call
    //     hard delete on these models. There is no soft-delete fallback that
    //     would be safe to inject automatically because hard-delete cascades
    //     to children differently from soft-delete.
    //   - The dev seed (`database/prisma/seed.ts`) intentionally uses
    //     `handover.deleteMany({ where: { referenceId } })` to refresh demo
    //     data, and rerouting that to soft-delete would cause a unique
    //     constraint violation on `referenceId` on the next reseed.
    //   - Reviewers should reject any new caller of `.delete*` on these
    //     models in service / route code.
  }
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

declare global {
  // eslint-disable-next-line no-var
  var __occPrisma__: ExtendedPrismaClient | undefined
}

export const prisma: ExtendedPrismaClient =
  globalThis.__occPrisma__ ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__occPrisma__ = prisma
}
