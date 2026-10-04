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

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>所属站点</span>
        <select v-model="filters.site">
          <option value="">全部站点</option>
          <option v-for="site in options.sites" :key="site.value" :value="site.value">
            {{ site.label }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>通讯方式</span>
        <select v-model="filters.comm">
          <option value="">全部方式</option>
          <option v-for="comm in options.comms" :key="comm" :value="comm">{{ comm }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>电池余量</span>
        <select v-model="filters.battery">
          <option value="">全部电量</option>
          <option
            v-for="bucket in options.batteryBuckets"
            :key="bucket.value"
            :value="bucket.value"
          >
            {{ bucket.label }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>设备状态</span>
        <select v-model="filters.status" :disabled="filters.onlyRepair">
          <option value="">全部状态</option>
          <option v-for="status in options.statuses" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
      </label>
      <label class="filter-item checkbox-item">
        <input v-model="filters.onlyRepair" type="checkbox" />
        <span>只看待维修</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <button class="btn ghost" type="button" @click="saveFilters">保存筛选</button>
    </form>
    <p class="filter-hint">
      列表按有效维护日期升序（最久未维护在前）；缺最近维护日的旧设备按原安装日期参与排序。
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </p>

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
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="isPending(row, action)"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的遥测设备，可调整筛选条件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listTelemetryDevices,
  moduleMeta,
  runAction as applyAction,
  telemetryFilterOptions,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useFilterStore } from '@/stores/filters'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('telemetry')
const columns = ["设备编号", "设备类型", "所属站点", "通讯方式", "安装日期", "最近维护日", "电池余量", "设备状态"]
const actions = ["报修设备", "确认修复", "停用设备"]
const statuses = ["正常运行", "信号异常", "低电量", "待维修", "已停用"]
const stats = [{"label": "设备总数", "value": 0}, {"label": "正常运行数", "value": 0}, {"label": "待维修数", "value": 0}]

const session = useSessionStore()
const filterStore = useFilterStore()
const options = telemetryFilterOptions()

const emptyFilters = () => ({ site: '', comm: '', battery: '', status: '', onlyRepair: false })

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref(emptyFilters())
// 正在处理中的行内动作：并发点击同一动作只放行第一次。
const pendingActions = ref(new Set<string>())
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isPending(row: EntryRow, action: string) {
  return pendingActions.value.has(`${row.id}:${action}`)
}

function applyFilters() {
  filterStore.applyFilters(meta.key, { ...filters.value })
  reload()
}

function resetFilters() {
  filters.value = emptyFilters()
  filterStore.applyFilters(meta.key, { ...filters.value })
  reload()
}

function saveFilters() {
  const result = filterStore.saveFilters(meta.key, { ...filters.value })
  noticeMessage.value = result.message
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  const token = `${row.id}:${action}`
  if (pendingActions.value.has(token)) {
    return
  }
  errorMessage.value = ''
  pendingActions.value.add(token)
  try {
    const result = applyAction(meta.key, Number(row.id), action, {
      operator: session.operator,
      role: session.role,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    pendingActions.value.delete(token)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listTelemetryDevices({ ...filters.value })
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(() => {
  // 返回页面时恢复上次生效的筛选，保留原列表。
  const restored = filterStore.applied[meta.key]
  if (restored) {
    filters.value = {
      site: String(restored.site ?? ''),
      comm: String(restored.comm ?? ''),
      battery: String(restored.battery ?? ''),
      status: String(restored.status ?? ''),
      onlyRepair: restored.onlyRepair === true,
    }
  }
  reload()
})
</script>
