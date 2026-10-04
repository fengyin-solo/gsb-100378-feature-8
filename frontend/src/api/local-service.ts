import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { pendingRepairsAtStation } from './telemetry-service'
import type { ActionOptions, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 只读动作：登记在模块动作里，但不改变任何状态，只做跨模块核查并把结果带回页面。
const READONLY_ACTIONS = new Set(['报修核查'])

// 报告故障前必须先核查同站点遥测设备的模块：巡检记录以站点编号关联。
const CROSS_CHECK_STATION_FIELD: Record<string, string> = {
  inspection: '站点编号',
}

// 在途动作：同一模块同一记录的同一动作在落库前只放行一次，并发点击不会产生两次状态流转/核查。
const inflightKeys = new Set<string>()

function inflightKey(key: string, id: number, action: string): string {
  return `${key}:${id}:${action}`
}

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

export function runAction(
  key: string,
  id: number,
  action: string,
  options: ActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const lock = inflightKey(key, id, action)
  if (inflightKeys.has(lock)) {
    // 并发保存：上一笔还没落库，本次直接拒绝，保证只生效一次。
    return { ok: false, message: '操作正在保存中，请勿重复提交' }
  }
  inflightKeys.add(lock)
  try {
    return executeAction(key, id, action, meta, options)
  } finally {
    inflightKeys.delete(lock)
  }
}

function executeAction(
  key: string,
  id: number,
  action: string,
  meta: ModuleMeta,
  options: ActionOptions,
): ActionResult {
  // 越权拦截：停用等高风险动作要求对应权限点，值班员操作直接拒绝，不写数据。
  const requiredPermission = meta.actionPermissions?.[action]
  if (requiredPermission && !(options.permissions ?? []).includes(requiredPermission)) {
    return {
      ok: false,
      message: `越权操作已拒绝：${meta.entity}「${action}」需要更高权限，请联系设备管理员`,
    }
  }

  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  // 报修核查：只读，按站点回查待维修遥测设备，巡检状态保持不变。
  if (READONLY_ACTIONS.has(action)) {
    const stationField = CROSS_CHECK_STATION_FIELD[key] ?? '站点编号'
    const stationRef = rows[index][stationField]
    const pendingRepairs = pendingRepairsAtStation(stationRef)
    return {
      ok: true,
      message:
        pendingRepairs.length > 0
          ? `核查结果：该站点已有 ${pendingRepairs.length} 台遥测设备处于待维修，请勿重复报修`
          : '核查结果：该站点暂无待维修遥测设备，可按故障流程报修',
      check: { station: String(stationRef ?? ''), pendingRepairs },
    }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 报告故障前的报修核查：同站点已有待维修遥测设备时，提示先跟修并阻止重复报修落库。
  let check: ActionResult['check']
  if (options.withCrossCheck && CROSS_CHECK_STATION_FIELD[key]) {
    const stationField = CROSS_CHECK_STATION_FIELD[key]
    const stationRef = rows[index][stationField]
    const pendingRepairs = pendingRepairsAtStation(stationRef)
    check = { station: String(stationRef ?? ''), pendingRepairs }
    if (action === '报告故障' && pendingRepairs.length > 0) {
      const devices = pendingRepairs.map((row) => row['设备编号']).join('、')
      return {
        ok: false,
        message: `报修核查未通过：该站点已有待维修遥测设备（${devices}），请等待修复后再报，或改走核查流程`,
        check,
      }
    }
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

  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (check && key === 'inspection' && action === '报告故障') {
    message += '；核查确认该站点暂无在修遥测设备，故障已登记'
  }
  return { ok: true, message, check }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
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
