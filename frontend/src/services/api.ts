import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Types ──────────────────────────────────────────────────────────────────

export type DeviceType = 'router' | 'switch' | 'firewall' | 'server' | 'unknown'
export type DeviceVendor = 'huawei' | 'mikrotik' | 'datacom' | 'cisco' | 'generic'
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown'

export interface Interface {
  id: number
  if_index: number
  if_name: string
  if_alias?: string
  if_speed?: number
  if_mac?: string
  if_admin_status?: number
  if_oper_status?: number
  ip_address?: string
  ip_mask?: string
}

export interface Device {
  id: number
  name: string
  hostname: string
  ip_address: string
  device_type: DeviceType
  vendor: DeviceVendor
  model?: string
  description?: string
  location?: string
  contact?: string
  status: DeviceStatus
  last_seen?: string
  uptime?: number
  snmp_enabled: boolean
  pos_x?: number
  pos_y?: number
  created_at?: string
  interfaces: Interface[]
}

export interface DeviceCreate {
  name: string
  hostname: string
  ip_address: string
  device_type?: DeviceType
  vendor?: DeviceVendor
  model?: string
  description?: string
  location?: string
  snmp_community?: string
  snmp_version?: string
  snmp_port?: number
  snmp_enabled?: boolean
}

export interface TopologyNode {
  id: string
  label: string
  ip_address: string
  device_type: DeviceType
  vendor: DeviceVendor
  status: DeviceStatus
  pos_x?: number
  pos_y?: number
  model?: string
  location?: string
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  source_interface?: string
  target_interface?: string
  bandwidth?: number
  discovered_via?: string
}

export interface Topology {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export interface MetricsSummary {
  total_devices: number
  up: number
  down: number
  degraded: number
  unknown: number
  health_pct: number
  timestamp: string
}

export interface MetricPoint {
  time: string
  value: number
}

export interface InterfaceMetrics {
  in_bps: MetricPoint[]
  out_bps: MetricPoint[]
}

// ── API calls ──────────────────────────────────────────────────────────────

export const devicesApi = {
  list: () => api.get<Device[]>('/devices/').then(r => r.data),
  get: (id: number) => api.get<Device>(`/devices/${id}`).then(r => r.data),
  create: (data: DeviceCreate) => api.post<Device>('/devices/', data).then(r => r.data),
  update: (id: number, data: Partial<DeviceCreate>) =>
    api.put<Device>(`/devices/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/devices/${id}`),
  poll: (id: number) => api.post<Device>(`/devices/${id}/poll`).then(r => r.data),
  updatePosition: (id: number, pos_x: number, pos_y: number) =>
    api.patch<Device>(`/devices/${id}/position`, { pos_x, pos_y }).then(r => r.data),
}

export const topologyApi = {
  get: () => api.get<Topology>('/topology/').then(r => r.data),
  createLink: (data: {
    source_device_id: number
    target_device_id: number
    source_interface_id?: number
    target_interface_id?: number
    bandwidth?: number
  }) => api.post('/topology/links', data).then(r => r.data),
  deleteLink: (id: number) => api.delete(`/topology/links/${id}`),
  discover: () => api.post('/topology/discover').then(r => r.data),
}

export const metricsApi = {
  summary: () => api.get<MetricsSummary>('/metrics/summary').then(r => r.data),
  interface: (deviceId: number, ifIndex: number, hours = 1) =>
    api.get<InterfaceMetrics>(`/metrics/interface/${deviceId}/${ifIndex}?hours=${hours}`).then(r => r.data),
}

export default api
