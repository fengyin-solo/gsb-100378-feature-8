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
  /** 动作所需权限点：未登记的动作不做权限限制（兼容原流转）。 */
  actionPermissions?: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

/** 报修核查：巡检报告故障时交叉核对同站点遥测设备的待维修情况。 */
export type RepairCheck = {
  station: string
  pendingRepairs: EntryRow[]
}

export type ActionOptions = {
  /** 当前操作员具备的权限点，用于越权校验（如停用设备）。 */
  permissions?: string[]
  operator?: string
  /** 报告故障等动作附带的跨模块核查。 */
  withCrossCheck?: boolean
}

export type ActionResult = {
  ok: boolean
  message: string
  /** ok 为 true 且做过核查时返回；重复提交等幂等短路不重复挂核查。 */
  check?: RepairCheck
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
