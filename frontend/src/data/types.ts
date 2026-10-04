/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 需要管理员角色才能执行的动作，越权调用会被拒绝 */
  adminActions?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 当前操作人：动作流转时带上，用于越权校验 */
export type Actor = {
  operator: string
  role: string
}

/** 遥测设备组合定位条件：站点、通讯方式、电池余量档位、状态，可只看待维修 */
export type TelemetryQuery = {
  site?: string
  comm?: string
  battery?: string
  status?: string
  onlyRepair?: boolean
}

export type RepairCheckResult = {
  ok: boolean
  message: string
  devices: EntryRow[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
