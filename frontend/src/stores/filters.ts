import { defineStore } from 'pinia'

import type { ActionResult } from '@/data/types'

// 列表筛选状态：生效中的条件随查随存，返回页面时恢复出原列表；
// 「保存筛选」是显式动作，并发或重复保存只生效一次。
const STORAGE_KEY = 'hydrology-monitor-station:filters'

export type FilterSnapshot = Record<string, string | boolean>

type FilterState = {
  applied: Record<string, FilterSnapshot>
  saved: Record<string, FilterSnapshot>
}

function readStorage(): FilterState {
  const fallback: FilterState = { applied: {}, saved: {} }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FilterState>
    return { applied: parsed.applied ?? {}, saved: parsed.saved ?? {} }
  } catch {
    return fallback
  }
}

function persist(state: FilterState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ applied: state.applied, saved: state.saved }),
    )
  }
}

// 正在保存中的模块令牌：并发保存同一模块的筛选只放行第一次。
const inFlightSaves = new Set<string>()

export const useFilterStore = defineStore('filters', {
  state: (): FilterState => readStorage(),
  actions: {
    applyFilters(moduleKey: string, filters: FilterSnapshot) {
      this.applied = { ...this.applied, [moduleKey]: { ...filters } }
      persist(this.$state)
    },
    saveFilters(moduleKey: string, filters: FilterSnapshot): ActionResult {
      if (inFlightSaves.has(moduleKey)) {
        return { ok: false, message: '筛选条件正在保存中，请勿重复提交' }
      }
      inFlightSaves.add(moduleKey)
      try {
        const snapshot = JSON.stringify(filters)
        const existing = this.saved[moduleKey]
        if (existing !== undefined && JSON.stringify(existing) === snapshot) {
          return { ok: false, message: '筛选条件与已保存的一致，无需重复保存' }
        }
        this.saved = { ...this.saved, [moduleKey]: { ...filters } }
        persist(this.$state)
        return { ok: true, message: '筛选条件已保存' }
      } finally {
        inFlightSaves.delete(moduleKey)
      }
    },
  },
})
