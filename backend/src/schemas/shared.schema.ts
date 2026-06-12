import { z } from 'zod'

export const EntityIdSchema = z
  .string()
  .trim()
  .min(1, 'Identifier is required')
  .max(255, 'Identifier is too long')

export const DateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const DateTimeString = z.string().datetime({ offset: true })

export const ShiftEnum = z.enum(['Morning', 'Night'])
export const PriorityEnum = z.enum(['Low', 'Normal', 'High', 'Critical'])
export const ItemStatusEnum = z.enum(['Open', 'Monitoring', 'Resolved'])

export const BaseOperationalItemSchema = z.object({
  status: ItemStatusEnum.default('Open'),
  priority: PriorityEnum.default('Normal'),
  ownerId: EntityIdSchema.optional(),
  dueTime: DateTimeString.optional(),
  remarks: z.string().max(2000).optional(),
})

export function validateOwnerRequiredForOpenHighPriorityItem(
  data: {
    status: z.infer<typeof ItemStatusEnum>
    priority: z.infer<typeof PriorityEnum>
    ownerId?: string | undefined
  },
  ctx: z.RefinementCtx
) {
  if (
    data.status === 'Open' &&
    (data.priority === 'High' || data.priority === 'Critical') &&
    !data.ownerId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ownerId is required for open High/Critical items',
      path: ['ownerId'],
    })
  }
}

export function validateDueTimeSyntax(
  dueTime: string | undefined,
  ctx: z.RefinementCtx
) {
  if (dueTime && Number.isNaN(Date.parse(dueTime))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dueTime must be a valid ISO datetime',
      path: ['dueTime'],
    })
  }
}

export function validateDueTimeWindow(
  dueTime: string | undefined,
  handoverDate: string,
  ctx: z.RefinementCtx,
  path: (string | number)[]
) {
  const errors = getDueTimeWindowErrors(dueTime, handoverDate)

  errors.forEach((message) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path,
    })
  })
}

export function getDueTimeWindowErrors(
  dueTime: string | undefined,
  handoverDate: string
) {
  if (!dueTime) {
    return [] as string[]
  }

  const dueAt = new Date(dueTime)

  if (Number.isNaN(dueAt.getTime())) {
    return [] as string[]
  }

  const handoverAt = new Date(`${handoverDate}T00:00:00.000Z`)
  const maxDueAt = new Date(handoverAt.getTime() + 72 * 60 * 60 * 1000)
  const errors: string[] = []

  if (dueAt <= new Date()) {
    errors.push('dueTime must be in the future')
  }

  if (dueAt > maxDueAt) {
    errors.push('dueTime must be within 72 hours of handoverDate')
  }

  return errors
}
