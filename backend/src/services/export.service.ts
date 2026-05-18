import { UserRole, type Prisma } from '@prisma/client'

import { prisma } from '../lib/prisma'
import { ServiceError } from '../lib/service-error'
import type { AuthenticatedUser } from '../middleware/auth.middleware'
import {
  buildHandoverListWhereClause,
  type HandoverFilters as ExportFilters,
} from './handover-query.service'

// -- CSV Export --

import { stringify } from 'csv-stringify/sync'

const HANDOVER_LIST_INCLUDE_FOR_EXPORT = {
  preparedBy: { select: { id: true, name: true } },
  handedTo: { select: { id: true, name: true } },
  aircraftItems: { where: { deletedAt: null }, select: { status: true } },
  airportItems: { where: { deletedAt: null }, select: { status: true } },
  flightScheduleItems: { where: { deletedAt: null }, select: { status: true } },
  crewItems: { where: { deletedAt: null }, select: { status: true } },
  weatherItems: { where: { deletedAt: null }, select: { status: true } },
  systemItems: { where: { deletedAt: null }, select: { status: true } },
  abnormalEvents: { where: { deletedAt: null }, select: { status: true } },
} satisfies Prisma.HandoverInclude

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function countByStatus(items: Array<{ status: string }>, target: string): number {
  return items.filter((i) => i.status === target).length
}

export async function exportHandoversCsv(
  user: AuthenticatedUser,
  filters: ExportFilters
): Promise<string> {
  const where = buildHandoverListWhereClause(user, filters)
  const handovers = await prisma.handover.findMany({
    where,
    include: HANDOVER_LIST_INCLUDE_FOR_EXPORT,
    orderBy: [{ overallPriority: 'desc' }, { createdAt: 'desc' }],
    take: 5000, // hard cap for export
  })

  const rows = handovers.map((h) => {
    const allItems = [
      ...h.aircraftItems,
      ...h.airportItems,
      ...h.flightScheduleItems,
      ...h.crewItems,
      ...h.weatherItems,
      ...h.systemItems,
      ...h.abnormalEvents,
    ]

    return {
      referenceId: h.referenceId,
      handoverDate: formatDateOnly(h.handoverDate),
      shift: h.shift,
      preparedBy: h.preparedBy.name,
      handedTo: h.handedTo?.name ?? '',
      overallPriority: h.overallPriority,
      overallStatus: h.overallStatus,
      openItemCount: countByStatus(allItems, 'Open'),
      monitoringItemCount: countByStatus(allItems, 'Monitoring'),
      resolvedItemCount: countByStatus(allItems, 'Resolved'),
      totalItemCount: allItems.length,
      isCarriedForward: h.isCarriedForward ? 'Yes' : 'No',
      createdAt: h.createdAt.toISOString(),
      acknowledgedAt: h.acknowledgedAt?.toISOString() ?? '',
    }
  })

  return stringify(rows, {
    header: true,
    columns: [
      { key: 'referenceId', header: 'Reference ID' },
      { key: 'handoverDate', header: 'Date' },
      { key: 'shift', header: 'Shift' },
      { key: 'preparedBy', header: 'Prepared By' },
      { key: 'handedTo', header: 'Handed To' },
      { key: 'overallPriority', header: 'Priority' },
      { key: 'overallStatus', header: 'Status' },
      { key: 'openItemCount', header: 'Open Items' },
      { key: 'monitoringItemCount', header: 'Monitoring Items' },
      { key: 'resolvedItemCount', header: 'Resolved Items' },
      { key: 'totalItemCount', header: 'Total Items' },
      { key: 'isCarriedForward', header: 'Carried Forward' },
      { key: 'createdAt', header: 'Created At' },
      { key: 'acknowledgedAt', header: 'Acknowledged At' },
    ],
  })
}

// -- PDF Export (generates HTML for server-side rendering) --

const DETAIL_INCLUDE = {
  preparedBy: { select: { id: true, name: true } },
  handedTo: { select: { id: true, name: true } },
  aircraftItems: { where: { deletedAt: null } },
  airportItems: { where: { deletedAt: null } },
  flightScheduleItems: { where: { deletedAt: null } },
  crewItems: { where: { deletedAt: null } },
  weatherItems: { where: { deletedAt: null } },
  systemItems: { where: { deletedAt: null } },
  abnormalEvents: { where: { deletedAt: null } },
} satisfies Prisma.HandoverInclude

type ItemRow = {
  category: string
  identifier: string
  issue: string
  status: string
  priority: string
  remarks: string
}

function priorityColor(p: string): string {
  if (p === 'Critical') return '#dc2626'
  if (p === 'High') return '#d97706'

  return '#334155'
}

function statusLabel(s: string): string {
  return s
}

export async function exportHandoverPdfHtml(
  id: string,
  user: AuthenticatedUser
): Promise<string> {
  const handover = await prisma.handover.findFirst({
    where: { id, deletedAt: null },
    include: DETAIL_INCLUDE,
  })

  if (!handover) {
    throw new ServiceError(404, 'NOT_FOUND', 'Handover not found')
  }

  // Access check: OCC_STAFF restricted to own handovers
  if (user.role === UserRole.OCC_STAFF && handover.preparedById !== user.id) {
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have access to this handover')
  }

  // Build item rows for all categories
  const items: ItemRow[] = []

  for (const item of handover.aircraftItems) {
    items.push({
      category: 'Aircraft',
      identifier: item.registration,
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.airportItems) {
    items.push({
      category: 'Airport',
      identifier: item.airport,
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.flightScheduleItems) {
    items.push({
      category: 'Flight Schedule',
      identifier: item.flightNumber,
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.crewItems) {
    items.push({
      category: 'Crew',
      identifier: item.crewName ?? item.crewId ?? '—',
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.weatherItems) {
    items.push({
      category: 'Weather',
      identifier: `${item.affectedArea} — ${item.weatherType}`,
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.systemItems) {
    items.push({
      category: 'System',
      identifier: item.systemName,
      issue: item.issue,
      status: item.status,
      priority: item.priority,
      remarks: item.remarks ?? '',
    })
  }

  for (const item of handover.abnormalEvents) {
    items.push({
      category: 'Abnormal Event',
      identifier: item.eventType,
      issue: item.description,
      status: item.status,
      priority: item.priority,
      remarks: '',
    })
  }

  const itemRowsHtml = items.length > 0
    ? items.map((item) =>
        `<tr>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.identifier)}</td>
          <td>${escapeHtml(item.issue)}</td>
          <td>${statusLabel(item.status)}</td>
          <td style="color:${priorityColor(item.priority)};font-weight:600">${escapeHtml(item.priority)}</td>
          <td>${escapeHtml(item.remarks)}</td>
        </tr>`
      ).join('\n')
    : '<tr><td colspan="6" style="text-align:center;color:#94a3b8">No items</td></tr>'

  const dateStr = formatDateOnly(handover.handoverDate)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Handover ${escapeHtml(handover.referenceId)}</title>
<style>
  body { font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 32px; margin: 0; font-size: 13px; }
  h1 { font-size: 22px; margin: 0; }
  .subtitle { color: #64748b; margin-top: 4px; font-size: 13px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-top: 20px; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; }
  .meta-value { margin-top: 2px; font-size: 13px; font-weight: 500; }
  .section { margin-top: 24px; }
  .section-title { font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; font-size: 12px; }
  th { background: #f8fafc; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .remarks-block { background: #f8fafc; border-radius: 6px; padding: 12px; margin-top: 12px; white-space: pre-wrap; font-size: 12px; line-height: 1.6; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(handover.referenceId)}</h1>
  <p class="subtitle">Handover Summary — Generated ${new Date().toISOString().slice(0, 10)}</p>

  <div class="meta-grid">
    <div><div class="meta-label">Date</div><div class="meta-value">${escapeHtml(dateStr)}</div></div>
    <div><div class="meta-label">Shift</div><div class="meta-value">${escapeHtml(handover.shift)}</div></div>
    <div><div class="meta-label">Priority</div><div class="meta-value" style="color:${priorityColor(handover.overallPriority)}">${escapeHtml(handover.overallPriority)}</div></div>
    <div><div class="meta-label">Status</div><div class="meta-value">${escapeHtml(handover.overallStatus)}</div></div>
    <div><div class="meta-label">Prepared By</div><div class="meta-value">${escapeHtml(handover.preparedBy.name)}</div></div>
    <div><div class="meta-label">Handed To</div><div class="meta-value">${escapeHtml(handover.handedTo?.name ?? '—')}</div></div>
    <div><div class="meta-label">Carried Forward</div><div class="meta-value">${handover.isCarriedForward ? 'Yes' : 'No'}</div></div>
    <div><div class="meta-label">Total Items</div><div class="meta-value">${items.length}</div></div>
  </div>

  ${handover.nextShiftActions ? `
  <div class="section">
    <div class="section-title">Next Shift Actions</div>
    <div class="remarks-block">${escapeHtml(handover.nextShiftActions)}</div>
  </div>
  ` : ''}

  ${handover.generalRemarks ? `
  <div class="section">
    <div class="section-title">General Remarks</div>
    <div class="remarks-block">${escapeHtml(handover.generalRemarks)}</div>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Category Items</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Identifier</th>
          <th>Issue</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
      </tbody>
    </table>
  </div>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
