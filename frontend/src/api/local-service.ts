import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  Actor,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RepairCheckResult,
  TelemetryQuery,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 需要管理员角色的角色名：越权停用等敏感动作会被拒绝。
const ADMIN_ROLE = '管理员'

// 正在处理中的动作令牌：并发或重复提交同一个动作时，只放行第一次。
const inFlightActions = new Set<string>()

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, actor?: Actor): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 越权校验：敏感动作（如停用设备）要求管理员角色，其余角色一律拒绝。
  if ((meta.adminActions ?? []).includes(action) && actor?.role !== ADMIN_ROLE) {
    const who = actor ? `${actor.operator}（${actor.role}）` : '未登记角色的用户'
    return { ok: false, message: `${who}无权执行「${action}」，该动作需要${ADMIN_ROLE}角色` }
  }
  const token = `${key}:${id}:${action}`
  if (inFlightActions.has(token)) {
    return { ok: false, message: `「${action}」正在处理中，请勿重复提交` }
  }
  inFlightActions.add(token)
  try {
    const rows = listRows(key)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const current = String(rows[index].status)
    if (current === target) {
      return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
    }
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    const updated: EntryRow = {
      ...rows[index],
      status: target,
      pending: target !== lastStatus,
      abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    }
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
  } finally {
    inFlightActions.delete(token)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---- 遥测设备：组合定位、维护排序与报修核查 ----

const TELEMETRY_KEY = 'telemetry'
const REPAIR_STATUS = '待维修'

// 电池余量档位：充足 ≥60%，偏低 20%~59%，危急 <20%。
const BATTERY_BUCKETS = [
  { value: 'high', label: '充足（≥60%）' },
  { value: 'mid', label: '偏低（20%~59%）' },
  { value: 'low', label: '危急（<20%）' },
]

function batteryBucketOf(raw: unknown): string {
  const parsed = Number.parseFloat(String(raw ?? '').replace('%', '').trim())
  if (Number.isNaN(parsed)) {
    return 'unknown'
  }
  if (parsed >= 60) {
    return 'high'
  }
  if (parsed >= 20) {
    return 'mid'
  }
  return 'low'
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/

// 排序口径：按有效维护日期升序，最久未维护的排最前；
// 缺最近维护日的旧数据按原安装日期兜底，两个日期都缺失的视为最旧排最前，并列按设备编号。
function maintenanceSortKey(row: EntryRow): string {
  const maintained = String(row['最近维护日'] ?? '').trim()
  if (DATE_PATTERN.test(maintained)) {
    return maintained
  }
  const installed = String(row['安装日期'] ?? '').trim()
  if (DATE_PATTERN.test(installed)) {
    return installed
  }
  return ''
}

function byMaintenanceDate(a: EntryRow, b: EntryRow): number {
  const keyA = maintenanceSortKey(a)
  const keyB = maintenanceSortKey(b)
  if (keyA !== keyB) {
    return keyA < keyB ? -1 : 1
  }
  return String(a['设备编号'] ?? '').localeCompare(String(b['设备编号'] ?? ''))
}

export function listTelemetryDevices(query: TelemetryQuery = {}): PageResult {
  const statusWanted = query.onlyRepair ? REPAIR_STATUS : (query.status ?? '').trim()
  const matched = listRows(TELEMETRY_KEY).filter((row) => {
    if (query.site && String(row['所属站点'] ?? '') !== query.site) {
      return false
    }
    if (query.comm && String(row['通讯方式'] ?? '') !== query.comm) {
      return false
    }
    if (query.battery && batteryBucketOf(row['电池余量']) !== query.battery) {
      return false
    }
    if (statusWanted && String(row.status) !== statusWanted) {
      return false
    }
    return true
  })
  const items = [...matched].sort(byMaintenanceDate)
  return { items, total: items.length, page: 1, size: items.length }
}

export function telemetryFilterOptions(): {
  sites: { value: string; label: string }[]
  comms: string[]
  statuses: string[]
  batteryBuckets: { value: string; label: string }[]
} {
  // 站点选项顺着站点数据流取监测站点模块，通讯方式从设备数据里去重。
  const sites = listRows('station')
    .map((row) => {
      const value = String(row['站点编号'] ?? '').trim()
      const name = String(row['站点名称'] ?? '').trim()
      return { value, label: name ? `${value} · ${name}` : value }
    })
    .filter((option) => option.value !== '')
  const comms = [
    ...new Set(
      listRows(TELEMETRY_KEY)
        .map((row) => String(row['通讯方式'] ?? '').trim())
        .filter((comm) => comm !== ''),
    ),
  ]
  return {
    sites,
    comms,
    statuses: moduleMeta(TELEMETRY_KEY).statuses,
    batteryBuckets: BATTERY_BUCKETS.map((bucket) => ({ ...bucket })),
  }
}

// 巡检页报修核查：按站点编号核对遥测设备里仍处于待维修的设备。
export function checkSiteRepairs(site: string): RepairCheckResult {
  const code = site.trim()
  if (!code) {
    return { ok: false, message: '巡检记录缺少站点编号，无法核查报修设备', devices: [] }
  }
  const devices = listRows(TELEMETRY_KEY).filter(
    (row) => String(row['所属站点'] ?? '') === code && String(row.status) === REPAIR_STATUS,
  )
  if (devices.length === 0) {
    return { ok: true, message: `站点 ${code} 暂无待维修的遥测设备`, devices }
  }
  const summary = devices
    .map((row) => `${row['设备编号']}（${row['通讯方式']}，电池${row['电池余量']}）`)
    .join('、')
  return {
    ok: true,
    message: `站点 ${code} 有 ${devices.length} 台遥测设备待维修：${summary}`,
    devices,
  }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
