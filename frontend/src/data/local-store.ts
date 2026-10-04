import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const VERSION_KEY = 'hydrology-monitor-station:entries-version'
// v2：遥测设备补齐站点/通讯方式/电池余量等真实字段，巡检站点编号改为可交叉核查的站点编号。
const CURRENT_VERSION = 2
// 随 v2 重置的模块：这些模块的旧种子是占位数据，核查与组合筛选都依赖新字段。
const RESEED_ON_UPGRADE = ['telemetry', 'inspection']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    let merged: Record<string, EntryRow[]>
    if (version < CURRENT_VERSION) {
      // 旧版本：遥测、巡检回到新种子；其他模块继续沿用浏览器里的数据。
      merged = { ...fallback, ...parsed }
      for (const key of RESEED_ON_UPGRADE) {
        merged[key] = clone(fallback[key] ?? [])
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    } else {
      merged = { ...fallback, ...parsed }
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
