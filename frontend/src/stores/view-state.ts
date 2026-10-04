import { defineStore } from 'pinia'

import type { EntryRow } from '@/data/types'

// 列表页视图状态：切到别的页面再回来时，筛选条件、排序和最后一次查到的列表原样保留。
// 组件卸载不丢状态（Pinia 单例），刷新浏览器后回到初始查询。
type TelemetryView = {
  filters: Record<string, unknown>
  order: 'asc' | 'desc'
  items: EntryRow[]
  total: number
}

type InspectionView = {
  filters: Record<string, string>
  items: EntryRow[]
  total: number
}

type ViewStateShape = {
  telemetry: TelemetryView | null
  inspection: InspectionView | null
}

// 保存筛选的在途标记：同一模块同一份条件并发保存只写一次。
const persistedKeys = new Set<string>()

export const useViewStateStore = defineStore('viewState', {
  state: (): ViewStateShape => ({
    telemetry: null,
    inspection: null,
  }),
  actions: {
    saveTelemetry(view: TelemetryView): void {
      this.telemetry = view
    },
    saveInspection(view: InspectionView): void {
      this.inspection = view
    },
    clear(module: keyof ViewStateShape): void {
      this[module] = null
    },
    // 筛选保存的并发去重：序列化后相同的并发保存只真正生效一次。
    tryMarkPersist(module: string, signature: string): boolean {
      const key = `${module}:${signature}`
      if (persistedKeys.has(key)) {
        return false
      }
      persistedKeys.add(key)
      window.setTimeout(() => persistedKeys.delete(key), 400)
      return true
    },
  },
})
