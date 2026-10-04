<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">维护遥测设备，围绕设备编号、设备类型、所属站点、通讯方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遥测设备</button>
        <button class="btn" type="button" @click="exportRows">导出遥测设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload()">
      <label class="filter-item">
        <span>所属站点</span>
        <select v-model="filters.station">
          <option value="">全部站点</option>
          <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>通讯方式</span>
        <select v-model="filters.channel">
          <option value="">全部方式</option>
          <option v-for="channel in channels" :key="channel" :value="channel">{{ channel }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>电池余量</span>
        <select v-model="filters.battery">
          <option value="">全部电量</option>
          <option v-for="level in batteryLevels" :key="level.value" :value="level.value">
            {{ level.label }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>设备状态</span>
        <select v-model="filters.status" :disabled="filters.onlyPending">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item filter-check">
        <input v-model="filters.onlyPending" type="checkbox" />
        <span>只看待维修</span>
      </label>
      <label class="filter-item">
        <span>编号 / 类型</span>
        <input v-model="filters.keyword" placeholder="按设备编号或类型检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">
            <button
              v-if="column === '最近维护日'"
              class="link sort-link"
              type="button"
              title="按最近维护日排序；缺失维护日的旧数据按安装日期参与排序"
              @click="toggleSort"
            >
              最近维护日{{ sortOrder === 'desc' ? ' ↓' : ' ↑' }}
            </button>
            <template v-else>{{ column }}</template>
          </th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '最近维护日'">
              <span v-if="hasMaintenance(row)">{{ row['最近维护日'] }}</span>
              <span v-else class="fallback-text" title="该设备未登记最近维护日，按安装日期兼容排序">
                {{ row['安装日期'] || '—' }}（安装日期）
              </span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              :class="{ disabled: isBusy(row, action) }"
              type="button"
              :title="action === '停用设备' && !canDeactivate ? `当前角色「${session.roleLabel}」无停用权限` : ''"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">没有符合组合条件的遥测设备</td>
        </tr>
      </tbody>
    </table>

    <p class="sort-hint">排序口径：优先按最近维护日{{ sortOrder === 'desc' ? '由近到远' : '由远到近' }}；缺维护日的旧数据回退安装日期参与排序，两个日期都缺的排在最后。</p>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录（筛选与排序在离开页面后保留）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="infoMessage" class="info-text">{{ infoMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  BATTERY_LEVELS,
  EMPTY_FILTERS,
  channelOptions,
  maintenanceSortKey,
  queryTelemetry,
  stationOptions,
  type SortOrder,
  type TelemetryFilters,
} from '@/api/telemetry-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { useViewStateStore } from '@/stores/view-state'

const meta = moduleMeta('telemetry')
const session = useSessionStore()
const viewState = useViewStateStore()

const columns = ["设备编号", "设备类型", "所属站点", "通讯方式", "安装日期", "最近维护日", "电池余量", "设备状态"]
const actions = ["报修设备", "确认修复", "停用设备"]
const statuses = ["正常运行", "信号异常", "低电量", "待维修", "已停用"]
const batteryLevels = BATTERY_LEVELS

const stations = stationOptions()
const channels = channelOptions()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const busyKeys = ref<Set<string>>(new Set())
const filters = ref<TelemetryFilters>({ ...EMPTY_FILTERS })
const sortOrder = ref<SortOrder>('desc')

const canDeactivate = computed(() => session.hasPermission('device:deactivate'))

const allRows = computed(() => listRows(meta.key))
const stats = computed(() => [
  { label: "设备总数", value: allRows.value.length },
  { label: "正常运行数", value: allRows.value.filter((row) => String(row.status) === '正常运行').length },
  { label: "待维修数", value: allRows.value.filter((row) => String(row.status) === '待维修').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 状态决定可执行动作：已停用的不能再报修/修复，待维修的不必重复报修。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '已停用') {
    return []
  }
  if (status === '待维修') {
    return ['确认修复', '停用设备']
  }
  return actions
}

function hasMaintenance(row: EntryRow): boolean {
  // 排序键等于维护日本身，说明维护日是有效日期；否则就是回退到了安装日期。
  return maintenanceSortKey(row) === String(row['最近维护日'] ?? '').trim() && String(row['最近维护日'] ?? '').trim() !== ''
}

function isBusy(row: EntryRow, action: string): boolean {
  return busyKeys.value.has(`${row.id}:${action}`)
}

function filterSignature(): string {
  return JSON.stringify([filters.value, sortOrder.value])
}

function persistSnapshot(items: EntryRow[], count: number) {
  viewState.saveTelemetry({
    filters: { ...filters.value },
    order: sortOrder.value,
    items,
    total: count,
  })
}

function resetFilters() {
  filters.value = { ...EMPTY_FILTERS }
  sortOrder.value = 'desc'
  reload(true)
}

function toggleSort() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const key = `${row.id}:${action}`
  if (busyKeys.value.has(key)) {
    errorMessage.value = '操作正在保存中，请勿重复提交'
    return
  }
  busyKeys.value.add(key)
  try {
    const result = applyAction(meta.key, Number(row.id), action, {
      permissions: session.permissions,
      operator: session.operator,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    infoMessage.value = result.message
    reload(true)
  } finally {
    busyKeys.value.delete(key)
  }
}

// force=true 表示动作后的强制刷新（数据已变），跳过「并发保存只生效一次」的去重窗口。
function reload(force = false) {
  errorMessage.value = ''
  if (!force && !viewState.tryMarkPersist(meta.key, filterSignature())) {
    // 同一份筛选/排序在保存窗口内重复提交：沿用上一次列表，不重复生效。
    return
  }
  try {
    const payload = queryTelemetry(filters.value, sortOrder.value)
    rows.value = payload.items
    total.value = payload.total
    persistSnapshot(payload.items, payload.total)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(() => {
  // 从别的页面返回：恢复上次的组合条件与排序，按原条件重新查询（保留原列表口径且数据为最新）。
  const saved = viewState.telemetry
  if (saved) {
    filters.value = { ...EMPTY_FILTERS, ...(saved.filters as TelemetryFilters) }
    sortOrder.value = saved.order
  }
  reload(true)
})
</script>

<style scoped>
.filter-check {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 6px;
}
.filter-check span {
  display: inline;
}
.sort-link {
  font: inherit;
  white-space: nowrap;
}
.fallback-text {
  color: var(--muted);
}
.sort-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.info-text {
  color: #17663a;
}
.link.disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
