import type { CategoryDraft } from '@/components/wizard/StepCategories'
import type { HandoverDraft } from '@/components/wizard/HandoverWizard'
import type {
  AbnormalEventDraft,
  AircraftItemDraft,
  AirportItemDraft,
  AnyItemDraft,
  CrewItemDraft,
  FlightScheduleItemDraft,
  SystemItemDraft,
  WeatherItemDraft,
} from '@/components/wizard/itemDrafts'
import type { CategoryCode } from '@/lib/types'

/**
 * Backend's `CreateHandoverSchema` shape (camelCase keys, with the
 * frontend `abnormal` category mapped to backend `abnormalEvents`).
 */
export interface CreateHandoverPayload {
  handoverDate: string
  shift: 'Morning' | 'Night'
  overallPriority: 'Low' | 'Normal' | 'High' | 'Critical'
  handedToId?: string
  generalRemarks?: string
  nextShiftActions?: string
  categories: Record<string, unknown[]>
}

function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed.length > 0) (out as Record<string, unknown>)[k] = trimmed
    } else if (v !== undefined && v !== null) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

function serializeItem(category: CategoryCode, item: AnyItemDraft): unknown {
  const base = { priority: item.priority }

  switch (category) {
    case 'aircraft': {
      const it = item as AircraftItemDraft
      return {
        ...base,
        ...omitEmpty({
          registration: it.registration,
          type: it.type,
          issue: it.issue,
          flightsAffected: it.flightsAffected,
        }),
      }
    }
    case 'airport': {
      const it = item as AirportItemDraft
      return {
        ...base,
        ...omitEmpty({
          airport: it.airport,
          issue: it.issue,
          flightsAffected: it.flightsAffected,
        }),
      }
    }
    case 'flightSchedule': {
      const it = item as FlightScheduleItemDraft
      return {
        ...base,
        ...omitEmpty({
          flightNumber: it.flightNumber,
          route: it.route,
          issue: it.issue,
        }),
      }
    }
    case 'crew': {
      const it = item as CrewItemDraft
      return {
        ...base,
        ...omitEmpty({
          crewName: it.crewName,
          role: it.role,
          issue: it.issue,
        }),
      }
    }
    case 'weather': {
      const it = item as WeatherItemDraft
      return {
        ...base,
        ...omitEmpty({
          affectedArea: it.affectedArea,
          weatherType: it.weatherType,
          issue: it.issue,
        }),
      }
    }
    case 'system': {
      const it = item as SystemItemDraft
      return {
        ...base,
        ...omitEmpty({
          systemName: it.systemName,
          issue: it.issue,
        }),
      }
    }
    case 'abnormal': {
      const it = item as AbnormalEventDraft
      return {
        ...base,
        ...omitEmpty({
          eventType: it.eventType,
          description: it.description,
          flightsAffected: it.flightsAffected,
        }),
      }
    }
  }
}

const FRONTEND_TO_BACKEND_CATEGORY_KEY: Record<CategoryCode, string> = {
  aircraft: 'aircraft',
  airport: 'airport',
  flightSchedule: 'flightSchedule',
  crew: 'crew',
  weather: 'weather',
  system: 'system',
  // BR-13 / API_SPEC: backend uses `abnormalEvents`, frontend uses `abnormal`.
  abnormal: 'abnormalEvents',
}

export function draftToCreateHandoverPayload(
  draft: HandoverDraft
): CreateHandoverPayload {
  const categories: Record<string, unknown[]> = {}

  for (const [code, value] of Object.entries(draft.categories) as Array<
    [CategoryCode, CategoryDraft | undefined]
  >) {
    if (!value?.enabled || value.items.length === 0) continue
    const backendKey = FRONTEND_TO_BACKEND_CATEGORY_KEY[code]
    categories[backendKey] = value.items.map((it) => serializeItem(code, it))
  }

  const payload: CreateHandoverPayload = {
    handoverDate: draft.handoverDate,
    shift: draft.shift,
    overallPriority: draft.overallPriority,
    categories,
  }

  if (draft.handedToId) payload.handedToId = draft.handedToId
  const generalRemarks = draft.generalRemarks.trim()
  if (generalRemarks.length > 0) payload.generalRemarks = generalRemarks
  const nextShiftActions = draft.nextShiftActions.trim()
  if (nextShiftActions.length > 0) payload.nextShiftActions = nextShiftActions

  return payload
}
