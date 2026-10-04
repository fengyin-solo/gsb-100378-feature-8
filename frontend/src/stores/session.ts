import { defineStore } from 'pinia'

// 角色与权限点：纯前端演示环境里用角色切换来体现「越权停用要拒绝」。
// 值班员负责巡检与报修，停用设备/缆道等高风险动作只有设备管理员能做。
export type RoleKey = 'operator' | 'equipmentAdmin'

type RoleDef = {
  key: RoleKey
  label: string
  permissions: string[]
}

export const ROLES: RoleDef[] = [
  { key: 'operator', label: '值班员', permissions: [] },
  {
    key: 'equipmentAdmin',
    label: '设备管理员',
    permissions: ['device:deactivate', 'warning:deactivate'],
  },
]

const ROLE_KEY = 'hydrology-monitor-station:role'

function readRole(): RoleKey {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(ROLE_KEY)
    if (saved === 'operator' || saved === 'equipmentAdmin') {
      return saved
    }
  }
  // 默认值班员：默认身份下点「停用设备」应当被拒绝。
  return 'operator'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
    role: readRole() as RoleKey,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    roleLabel(state): string {
      return ROLES.find((item) => item.key === state.role)?.label ?? state.role
    },
    permissions(state): string[] {
      return ROLES.find((item) => item.key === state.role)?.permissions ?? []
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: RoleKey) {
      this.role = role
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ROLE_KEY, role)
      }
    },
    hasPermission(permission: string): boolean {
      return this.permissions.includes(permission)
    },
  },
})
