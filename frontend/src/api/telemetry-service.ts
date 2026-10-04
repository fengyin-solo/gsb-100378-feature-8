import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 遥测设备的组合定位条件：站点 + 通讯方式 + 电池余量档位 + 状态，状态里可一键只看待维修。
export type TelemetryFilters = {
  station: string
  channel: string
  battery: string
  status: string
  keyword: string
  onlyPending: boolean
}

export type SortOrder = 'asc' | 'desc'

export const BATTERY_LEVELS = [
  { value: 'high', label: '高电量（≥60%）' },
  { value: 'mid', label: '中电量（20%–60%）' },
  { value: 'low', label: '低电量（<20%）' },
] as const

export const EMPTY_FILTERS: TelemetryFilters = {
  station: '',
  channel: '',
  battery: '',
  status: '',
  keyword: '',
  onlyPending: false,
}

// 旧数据里电池余量可能是占位文字、纯数字或带百分号：统一解析成百分数，无法识别返回 null。
export function batteryPercent(row: EntryRow): number | null {
  const raw = row['电池余量']
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1 ? raw : raw * 100
  }
  const text = String(raw ?? '').trim()
  const matched = text.match(/(\d+(?:\.\d+)?)\s*%?/)
  if (!matched) {
    return null
  }
  const value = Number(matched[1])
  return Number.isFinite(value) ? value : null
}

export function batteryBucket(row: EntryRow): string {
  const percent = batteryPercent(row)
  if (percent === null) {
    return ''
  }
  if (percent < 20) {
    return 'low'
  }
  if (percent < 60) {
    return 'mid'
  }
  return 'high'
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function asDate(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) {
    return ''
  }
  return text
}

// 排序口径：优先按最近维护日；维护日缺失（早期设备登记时没有这一项）的旧数据回退安装日期；
// 两个日期都没有的排到最后。YYYY-MM-DD 可直接按字符串比较。
export function maintenanceSortKey(row: EntryRow): string {
  return asDate(row['最近维护日']) || asDate(row['安装日期']) || ''
}

// 取「STAT-xxxx」站点编号：遥测的所属站点是「STAT-0001 临江水文站」，巡检的站点编号是「STAT-0001」，
// 都按编号前缀对齐，文字部分不影响核查。
export function stationCode(value: unknown): string {
  const matched = String(value ?? '').match(/STAT-\w+/)
  return matched ? matched[0] : String(value ?? '').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function stationOptions(rows: EntryRow[] = listRows('telemetry')): string[] {
  return unique(rows.map((row) => String(row['所属站点'] ?? '')))
}

export function channelOptions(rows: EntryRow[] = listRows('telemetry')): string[] {
  return unique(rows.map((row) => String(row['通讯方式'] ?? '')))
}

function matchBattery(row: EntryRow, level: string): boolean {
  if (!level) {
    return true
  }
  const bucket = batteryBucket(row)
  // 无法识别电量的旧数据不进入任何档位，避免把占位值误算进低电量。
  return bucket !== '' && bucket === level
}

export function queryTelemetry(
  filters: TelemetryFilters,
  order: SortOrder = 'desc',
): { items: EntryRow[]; total: number } {
  const keyword = filters.keyword.trim()
  const items = listRows('telemetry').filter((row) => {
    if (filters.station && String(row['所属站点'] ?? '') !== filters.station) {
      return false
    }
    if (filters.channel && String(row['通讯方式'] ?? '') !== filters.channel) {
      return false
    }
    if (!matchBattery(row, filters.battery)) {
      return false
    }
    // 「只看待维修」与状态下拉是同一维度：勾选后以待维修为准。
    const expectedStatus = filters.onlyPending ? '待维修' : filters.status
    if (expectedStatus && String(row.status) !== expectedStatus) {
      return false
    }
    if (keyword) {
      const haystack = `${row['设备编号'] ?? ''}${row['设备类型'] ?? ''}`
      if (!haystack.includes(keyword)) {
        return false
      }
    }
    return true
  })

  items.sort((a, b) => {
    const keyA = maintenanceSortKey(a)
    const keyB = maintenanceSortKey(b)
    if (!keyA && !keyB) {
      return Number(a.id) - Number(b.id)
    }
    if (!keyA) {
      return 1
    }
    if (!keyB) {
      return -1
    }
    const compared = keyA.localeCompare(keyB)
    if (compared !== 0) {
      return order === 'asc' ? compared : -compared
    }
    return Number(a.id) - Number(b.id)
  })

  return { items, total: items.length }
}

// 报修核查：按站点编号找待维修遥测设备。站点文字（名称）不一致时仍能按编号对上。
export function pendingRepairsAtStation(stationRef: unknown): EntryRow[] {
  const code = stationCode(stationRef)
  if (!code) {
    return []
  }
  return listRows('telemetry').filter(
    (row) =>
      String(row.status) === '待维修' &&
      (stationCode(row['所属站点']) === code || String(row['所属站点'] ?? '').includes(code)),
  )
}
