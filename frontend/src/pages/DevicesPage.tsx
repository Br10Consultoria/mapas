import { useEffect, useState } from 'react'
import { devicesApi, Device, DeviceCreate, DeviceType, DeviceVendor } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'
import {
  Plus, RefreshCw, Trash2, Play, X, CheckCircle2,
  XCircle, AlertTriangle, HelpCircle, Pencil
} from 'lucide-react'
import clsx from 'clsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    up:       { cls: 'badge-up',       icon: CheckCircle2,  label: 'Online' },
    down:     { cls: 'badge-down',     icon: XCircle,       label: 'Offline' },
    degraded: { cls: 'badge-degraded', icon: AlertTriangle, label: 'Degradado' },
    unknown:  { cls: 'badge-unknown',  icon: HelpCircle,    label: 'Desconhecido' },
  }
  const { cls, icon: Icon, label } = map[status] || map.unknown
  return (
    <span className={cls}>
      <Icon size={11} />
      {label}
    </span>
  )
}

const DEVICE_TYPES: DeviceType[] = ['router', 'switch', 'firewall', 'server', 'unknown']
const DEVICE_VENDORS: DeviceVendor[] = ['huawei', 'mikrotik', 'datacom', 'cisco', 'generic']

const TYPE_LABELS: Record<DeviceType, string> = {
  router: 'Roteador', switch: 'Switch', firewall: 'Firewall',
  server: 'Servidor', unknown: 'Desconhecido',
}
const VENDOR_LABELS: Record<DeviceVendor, string> = {
  huawei: 'Huawei', mikrotik: 'MikroTik', datacom: 'Datacom',
  cisco: 'Cisco', generic: 'Genérico',
}

// ── Device Form (shared by Add and Edit) ─────────────────────────────────────

interface DeviceFormProps {
  initial: DeviceCreate
  title: string
  submitLabel: string
  onClose: () => void
  onSubmit: (form: DeviceCreate) => Promise<void>
}

function DeviceForm({ initial, title, submitLabel, onClose, onSubmit }: DeviceFormProps) {
  const [form, setForm] = useState<DeviceCreate>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof DeviceCreate, value: any) =>
    setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onSubmit(form)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao salvar dispositivo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nome *</label>
              <input
                className="input"
                placeholder="ex: SW-CORE-01"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Hostname *</label>
              <input
                className="input"
                placeholder="ex: sw-core-01.empresa.local"
                value={form.hostname}
                onChange={e => set('hostname', e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label">Endereço IP *</label>
            <input
              className="input font-mono"
              placeholder="ex: 192.168.1.1"
              value={form.ip_address}
              onChange={e => set('ip_address', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo</label>
              <select
                className="input"
                value={form.device_type}
                onChange={e => set('device_type', e.target.value)}
              >
                {DEVICE_TYPES.map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fabricante</label>
              <select
                className="input"
                value={form.vendor}
                onChange={e => set('vendor', e.target.value)}
              >
                {DEVICE_VENDORS.map(v => (
                  <option key={v} value={v}>{VENDOR_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Modelo</label>
              <input
                className="input"
                placeholder="ex: S5720-28X-SI"
                value={form.model || ''}
                onChange={e => set('model', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Localização</label>
              <input
                className="input"
                placeholder="ex: Rack A - Sala 01"
                value={form.location || ''}
                onChange={e => set('location', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Descrição</label>
            <input
              className="input"
              placeholder="Descrição opcional do dispositivo"
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          {/* SNMP */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Configuração SNMP
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Comunidade</label>
                <input
                  className="input font-mono"
                  value={form.snmp_community || 'public'}
                  onChange={e => set('snmp_community', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Versão</label>
                <select
                  className="input"
                  value={form.snmp_version || '2c'}
                  onChange={e => set('snmp_version', e.target.value)}
                >
                  <option value="1">v1</option>
                  <option value="2c">v2c</option>
                </select>
              </div>
              <div>
                <label className="label">Porta</label>
                <input
                  className="input font-mono"
                  type="number"
                  value={form.snmp_port || 161}
                  onChange={e => set('snmp_port', Number(e.target.value))}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                id="snmp_enabled"
                type="checkbox"
                checked={form.snmp_enabled ?? true}
                onChange={e => set('snmp_enabled', e.target.checked)}
                className="rounded border-slate-300 text-primary-600"
              />
              <label htmlFor="snmp_enabled" className="text-sm text-slate-700 cursor-pointer">
                SNMP habilitado
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              {loading ? 'Salvando...' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editDevice, setEditDevice] = useState<Device | null>(null)
  const [polling, setPolling] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const { deviceStatuses } = useWebSocket()

  const load = async () => {
    setLoading(true)
    try {
      setDevices(await devicesApi.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handlePoll = async (id: number) => {
    setPolling(id)
    try {
      const updated = await devicesApi.poll(id)
      setDevices(prev => prev.map(d => d.id === id ? updated : d))
    } finally {
      setPolling(null)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Remover este dispositivo?')) return
    setDeleting(id)
    try {
      await devicesApi.delete(id)
      setDevices(prev => prev.filter(d => d.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  const handleCreate = async (form: DeviceCreate) => {
    await devicesApi.create(form)
    await load()
  }

  const handleEdit = async (form: DeviceCreate) => {
    if (!editDevice) return
    await devicesApi.update(editDevice.id, form)
    await load()
  }

  const mergedDevices = devices.map(d => ({
    ...d,
    status: deviceStatuses[String(d.id)]?.status ?? d.status,
  }))

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dispositivos</h1>
          <p className="text-sm text-slate-500 mt-0.5">{devices.length} dispositivos cadastrados</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            <Plus size={15} />
            Adicionar Dispositivo
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-slate-300" />
            Carregando dispositivos...
          </div>
        ) : mergedDevices.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Plus size={28} className="text-slate-300" />
            </div>
            <p className="text-slate-600 font-medium">Nenhum dispositivo cadastrado</p>
            <p className="text-sm text-slate-400 mt-1 mb-4">
              Adicione roteadores, switches e outros dispositivos para monitorar.
            </p>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              <Plus size={14} /> Adicionar Primeiro Dispositivo
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Nome', 'IP', 'Tipo', 'Fabricante', 'Modelo', 'Localização', 'SNMP', 'Status', 'Último Contato', 'Ações'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {mergedDevices.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{d.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{d.hostname}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{d.ip_address}</td>
                    <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[d.device_type as DeviceType] || d.device_type}</td>
                    <td className="px-4 py-3 text-slate-600">{VENDOR_LABELS[d.vendor as DeviceVendor] || d.vendor}</td>
                    <td className="px-4 py-3 text-slate-500">{d.model || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{d.location || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'text-xs font-medium',
                        d.snmp_enabled ? 'text-emerald-600' : 'text-slate-400'
                      )}>
                        {d.snmp_enabled ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {d.last_seen ? new Date(d.last_seen).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Poll */}
                        <button
                          onClick={() => handlePoll(d.id)}
                          disabled={polling === d.id}
                          title="Consultar agora"
                          className="p-1.5 hover:bg-primary-50 text-primary-600 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {polling === d.id
                            ? <RefreshCw size={14} className="animate-spin" />
                            : <Play size={14} />}
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => setEditDevice(d)}
                          title="Editar dispositivo"
                          className="p-1.5 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(d.id)}
                          disabled={deleting === d.id}
                          title="Remover"
                          className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <DeviceForm
          title="Adicionar Dispositivo"
          submitLabel="Adicionar"
          initial={{
            name: '', hostname: '', ip_address: '',
            device_type: 'unknown', vendor: 'generic',
            snmp_community: 'public', snmp_version: '2c',
            snmp_port: 161, snmp_enabled: true,
          }}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Edit Modal */}
      {editDevice && (
        <DeviceForm
          title={`Editar — ${editDevice.name}`}
          submitLabel="Salvar Alterações"
          initial={{
            name: editDevice.name,
            hostname: editDevice.hostname,
            ip_address: editDevice.ip_address,
            device_type: editDevice.device_type,
            vendor: editDevice.vendor,
            model: editDevice.model || '',
            description: editDevice.description || '',
            location: editDevice.location || '',
            snmp_community: (editDevice as any).snmp_community || 'public',
            snmp_version: (editDevice as any).snmp_version || '2c',
            snmp_port: (editDevice as any).snmp_port || 161,
            snmp_enabled: editDevice.snmp_enabled,
          }}
          onClose={() => setEditDevice(null)}
          onSubmit={handleEdit}
        />
      )}
    </div>
  )
}
