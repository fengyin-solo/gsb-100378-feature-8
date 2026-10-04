<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转；报告故障前先核查同站点遥测设备的在修情况。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="lastCheck" class="check-panel" :class="{ warn: lastCheck.pendingRepairs.length > 0 }">
      <strong>报修核查（站点 {{ lastCheck.station || '未知' }}）：</strong>
      <template v-if="lastCheck.pendingRepairs.length">
        已有 {{ lastCheck.pendingRepairs.length }} 台遥测设备待维修：
        <span v-for="device in lastCheck.pendingRepairs" :key="String(device.id)" class="check-device">
          {{ device['设备编号'] }}（{{ device['设备类型'] }}，余量 {{ device['电池余量'] }}）
        </span>
        <em>请跟进现有维修单，不要重复报修。</em>
      </template>
      <template v-else>该站点暂无待维修遥测设备，可按故障流程登记。</template>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              :class="{ disabled: isBusy(row, action) }"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录（筛选条件在离开页面后保留）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="infoMessage" class="info-text">{{ infoMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow, RepairCheck } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { useViewStateStore } from '@/stores/view-state'

const meta = moduleMeta('inspection')
const session = useSessionStore()
const viewState = useViewStateStore()

const columns = ["记录编号", "站点编号", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const statuses = ["待巡检", "已巡检", "发现故障", "已处置"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const lastCheck = ref<RepairCheck | null>(null)
const busyKeys = ref<Set<string>>(new Set())
const filters = ref<Record<string, string>>({})
const filterFields = ["记录编号", "站点编号", "巡检人员"]

const allRows = computed(() => listRows(meta.key))
const stats = computed(() => [
  { label: "本月巡检次数", value: allRows.value.length },
  { label: "已巡检站点", value: allRows.value.filter((row) => ['已巡检', '已处置'].includes(String(row.status))).length },
  { label: "待处置故障", value: allRows.value.filter((row) => String(row.status) === '发现故障').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 报修核查对所有记录开放（只读）；报告故障仅在尚未判定故障时可用，处置完成后不可重复报。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  const base =
    status === '待巡检'
      ? ['完成巡检', '报告故障', '报修核查']
      : status === '已巡检'
        ? ['报告故障', '报修核查']
        : status === '发现故障'
          ? ['确认处置', '报修核查']
          : ['报修核查']
  return base
}

function isBusy(row: EntryRow, action: string): boolean {
  return busyKeys.value.has(`${row.id}:${action}`)
}

function resetFilters() {
  filters.value = {}
  reload(true)
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
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
      // 报告故障落库前强制过一遍同站点报修核查；核查动作本身只读。
      withCrossCheck: true,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      if (result.check) {
        lastCheck.value = result.check
      }
      return
    }
    infoMessage.value = result.message
    if (result.check) {
      lastCheck.value = result.check
    }
    reload(true)
  } finally {
    busyKeys.value.delete(key)
  }
}

function reload(force = false) {
  errorMessage.value = ''
  const signature = JSON.stringify(filters.value)
  if (!force && !viewState.tryMarkPersist(meta.key, signature)) {
    return
  }
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    viewState.saveInspection({ filters: { ...filters.value }, items: payload.items, total: payload.total })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(() => {
  // 返回本页时恢复原筛选条件，按原条件重新查询，列表口径保持不变。
  const saved = viewState.inspection
  if (saved) {
    filters.value = { ...saved.filters }
  }
  reload(true)
})
</script>

<style scoped>
.check-panel {
  background: #eef8f1;
  border: 1px solid #b7e0c4;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #17663a;
}
.check-panel.warn {
  background: #fdf3ea;
  border-color: #f0c89a;
  color: #9a4b12;
}
.check-device {
  margin: 0 8px 0 4px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 999px;
  padding: 1px 8px;
}
.info-text {
  color: #17663a;
}
.link.disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
