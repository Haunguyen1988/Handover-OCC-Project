import { ItemStatus, Priority, Shift, UserRole } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Prisma mock
//
// export.service has two surfaces:
//
//   1. exportHandoversCsv(user, filters)
//      → reads many handovers via prisma.handover.findMany(...)
//      → reuses buildHandoverListWhereClause from handover-query.service
//        (NOT mocked — the real where-clause builder runs and we just
//        verify the filtered Prisma call receives a sensible `where`)
//      → renders CSV with `csv-stringify/sync` (real lib, no mock)
//
//   2. exportHandoverPdfHtml(id, user)
//      → reads one handover via prisma.handover.findFirst(...)
//      → renders HTML with hand-rolled escapeHtml — the security-critical
//        path that justifies most of this file's coverage.
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  handover: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  exportHandoverPdfHtml,
  exportHandoversCsv,
} from '../../../backend/src/services/export.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAFF_USER = {
  id: 'user-staff',
  name: 'Staff One',
  email: 'staff@example.test',
  role: UserRole.OCC_STAFF,
} as const

const SUPERVISOR_USER = {
  id: 'user-supervisor',
  name: 'Super',
  email: 'super@example.test',
  role: UserRole.SUPERVISOR,
} as const

function makeListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h-1',
    referenceId: 'HDO-2099-000001',
    handoverDate: new Date('2099-04-23T00:00:00Z'),
    shift: Shift.Morning,
    preparedBy: { id: STAFF_USER.id, name: STAFF_USER.name },
    handedTo: { id: SUPERVISOR_USER.id, name: SUPERVISOR_USER.name },
    overallPriority: Priority.High,
    overallStatus: ItemStatus.Open,
    isCarriedForward: false,
    aircraftItems: [{ status: ItemStatus.Open }],
    airportItems: [],
    flightScheduleItems: [{ status: ItemStatus.Resolved }],
    crewItems: [],
    weatherItems: [{ status: ItemStatus.Monitoring }],
    systemItems: [],
    abnormalEvents: [],
    createdAt: new Date('2099-04-23T08:00:00Z'),
    acknowledgedAt: null,
    ...overrides,
  }
}

function makeDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h-1',
    referenceId: 'HDO-2099-000001',
    handoverDate: new Date('2099-04-23T00:00:00Z'),
    shift: Shift.Morning,
    overallPriority: Priority.High,
    overallStatus: ItemStatus.Open,
    isCarriedForward: false,
    preparedById: STAFF_USER.id,
    preparedBy: { id: STAFF_USER.id, name: STAFF_USER.name },
    handedTo: null,
    generalRemarks: null,
    nextShiftActions: null,
    aircraftItems: [],
    airportItems: [],
    flightScheduleItems: [],
    crewItems: [],
    weatherItems: [],
    systemItems: [],
    abnormalEvents: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('export.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // exportHandoversCsv
  // -------------------------------------------------------------------------

  describe('exportHandoversCsv', () => {
    it('returns a header-only CSV when there are no rows', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([])

      const csv = await exportHandoversCsv(SUPERVISOR_USER, {})

      const lines = csv.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('Reference ID')
      expect(lines[0]).toContain('Acknowledged At')
    })

    it('renders a row per handover with the correct counts and Yes/No flag', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        makeListRow(),
        makeListRow({
          id: 'h-2',
          referenceId: 'HDO-2099-000002',
          isCarriedForward: true,
          handedTo: null,
          aircraftItems: [
            { status: ItemStatus.Open },
            { status: ItemStatus.Open },
          ],
          flightScheduleItems: [],
          weatherItems: [],
        }),
      ])

      const csv = await exportHandoversCsv(SUPERVISOR_USER, {})
      const lines = csv.trim().split('\n')

      expect(lines).toHaveLength(3) // header + 2 rows
      expect(lines[1]).toContain('HDO-2099-000001')
      // Row 1: 1 open + 1 monitoring + 1 resolved = 3 total, isCarriedForward=No
      expect(lines[1]).toMatch(/,1,1,1,3,No,/)
      // Row 2: 2 open + 0 monitoring + 0 resolved = 2 total, isCarriedForward=Yes
      expect(lines[2]).toContain('HDO-2099-000002')
      expect(lines[2]).toMatch(/,2,0,0,2,Yes,/)
    })

    it('renders an empty handedTo cell when no recipient is set', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        makeListRow({ handedTo: null }),
      ])

      const csv = await exportHandoversCsv(SUPERVISOR_USER, {})
      const dataRow = csv.trim().split('\n')[1] ?? ''

      // Find the cell after preparedBy (Staff One). The next cell is handedTo.
      // We just verify there's no SUPERVISOR name leaking in when handedTo=null.
      expect(dataRow).not.toContain('Super')
    })

    it('caps the export at 5000 rows (hard cap, BR-not-numbered)', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([])

      await exportHandoversCsv(SUPERVISOR_USER, {})

      const callArgs = prismaMock.handover.findMany.mock.calls[0]?.[0] as
        | { take?: number }
        | undefined
      expect(callArgs?.take).toBe(5000)
    })

    it('passes the user through to the where-clause builder so OCC_STAFF only sees their own handovers', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([])

      await exportHandoversCsv(STAFF_USER, {})

      const callArgs = prismaMock.handover.findMany.mock.calls[0]?.[0] as
        | { where?: Record<string, unknown> }
        | undefined
      // The real buildHandoverListWhereClause emits an AND-array when the
      // user is OCC_STAFF, with `preparedById: user.id` somewhere inside it.
      // We don't depend on the exact shape; just that the user id appears.
      const serialized = JSON.stringify(callArgs?.where ?? {})
      expect(serialized).toContain(STAFF_USER.id)
    })
  })

  // -------------------------------------------------------------------------
  // exportHandoverPdfHtml — access control + HTML escaping
  // -------------------------------------------------------------------------

  describe('exportHandoverPdfHtml', () => {
    it('throws NOT_FOUND when the handover does not exist', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(null)

      await expect(
        exportHandoverPdfHtml('missing', SUPERVISOR_USER)
      ).rejects.toThrow('Handover not found')
    })

    it("throws FORBIDDEN when an OCC_STAFF tries to export someone else's handover", async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({ preparedById: 'someone-else' })
      )

      await expect(
        exportHandoverPdfHtml('h-1', STAFF_USER)
      ).rejects.toThrow('You do not have access to this handover')
    })

    it('lets a SUPERVISOR export any handover regardless of preparer', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({ preparedById: 'someone-else' })
      )

      const html = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)

      expect(html).toContain('HDO-2099-000001')
    })

    it('renders a "No items" placeholder row when every category is empty', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(makeDetailRow())

      const html = await exportHandoverPdfHtml('h-1', STAFF_USER)

      expect(html).toContain('No items')
      expect(html).toContain('HDO-2099-000001')
    })

    it('renders an item row from every category that has items', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({
          aircraftItems: [
            {
              registration: 'VN-A1',
              issue: 'Aircraft issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          airportItems: [
            {
              airport: 'SGN',
              issue: 'Airport issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          flightScheduleItems: [
            {
              flightNumber: 'VJ100',
              issue: 'Flight issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          crewItems: [
            {
              crewName: 'Captain X',
              crewId: 'C-1',
              issue: 'Crew issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          weatherItems: [
            {
              affectedArea: 'WMKK',
              weatherType: 'TS',
              issue: 'Weather issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          systemItems: [
            {
              systemName: 'AIMS',
              issue: 'System issue',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
          abnormalEvents: [
            {
              eventType: 'AOG',
              description: 'Abnormal event description',
              status: ItemStatus.Open,
              priority: Priority.Critical,
            },
          ],
        })
      )

      const html = await exportHandoverPdfHtml('h-1', STAFF_USER)

      expect(html).toContain('Aircraft')
      expect(html).toContain('Airport')
      expect(html).toContain('Flight Schedule')
      expect(html).toContain('Crew')
      expect(html).toContain('Weather')
      expect(html).toContain('System')
      expect(html).toContain('Abnormal Event')
      expect(html).not.toContain('No items')
      // Crew identifier should prefer crewName over crewId.
      expect(html).toContain('Captain X')
      // Weather identifier is "<area> — <type>".
      expect(html).toContain('WMKK — TS')
    })

    it('uses crewId when crewName is null', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({
          crewItems: [
            {
              crewName: null,
              crewId: 'C-FALLBACK',
              issue: 'No name',
              status: ItemStatus.Open,
              priority: Priority.Normal,
              remarks: null,
            },
          ],
        })
      )

      const html = await exportHandoverPdfHtml('h-1', STAFF_USER)
      expect(html).toContain('C-FALLBACK')
    })

    it('escapes HTML metacharacters in user-provided fields (XSS protection)', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({
          referenceId: 'HDO-<script>alert(1)</script>',
          generalRemarks: '<img src=x onerror="alert(2)">',
          nextShiftActions: 'Use AT&T phones',
          aircraftItems: [
            {
              registration: '"VN-A&B"',
              issue: "Engineer's note: <em>monitor</em>",
              status: ItemStatus.Open,
              priority: Priority.High,
              remarks: 'O\'Brien checked it',
            },
          ],
        })
      )

      const html = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)

      // None of the raw injection vectors should survive verbatim.
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).not.toContain('<img src=x onerror="alert(2)">')
      expect(html).not.toContain('<em>monitor</em>')

      // The escaped forms must be present.
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;')
      expect(html).toContain('&lt;em&gt;monitor&lt;/em&gt;')
      expect(html).toContain('AT&amp;T')
      expect(html).toContain('&quot;VN-A&amp;B&quot;')
      expect(html).toContain('Engineer&#39;s note')
      expect(html).toContain('O&#39;Brien')
    })

    it('renders generalRemarks and nextShiftActions sections only when present', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({
          generalRemarks: 'Watch the weather',
          nextShiftActions: 'Coordinate with engineering',
        })
      )

      const html = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)

      expect(html).toContain('Next Shift Actions')
      expect(html).toContain('Coordinate with engineering')
      expect(html).toContain('General Remarks')
      expect(html).toContain('Watch the weather')
    })

    it('omits the optional sections when both fields are null', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(makeDetailRow())

      const html = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)

      expect(html).not.toContain('Next Shift Actions')
      expect(html).not.toContain('General Remarks')
    })

    it('shows "Yes"/"No" for the Carried Forward badge', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({ isCarriedForward: true })
      )
      const carriedHtml = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)
      expect(carriedHtml).toMatch(/Carried Forward<\/div><div[^>]*>Yes</)

      vi.clearAllMocks()
      prismaMock.handover.findFirst.mockResolvedValueOnce(
        makeDetailRow({ isCarriedForward: false })
      )
      const notCarriedHtml = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)
      expect(notCarriedHtml).toMatch(/Carried Forward<\/div><div[^>]*>No</)
    })

    it('shows the em-dash placeholder in the "Handed To" cell when handedTo is null', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(makeDetailRow())

      const html = await exportHandoverPdfHtml('h-1', SUPERVISOR_USER)

      // The "Handed To" cell renders an em dash when handedTo is null.
      expect(html).toMatch(/Handed To<\/div><div[^>]*>—</)
    })
  })
})
