import { useEffect, useState } from 'react'
import { metricsApi, devicesApi, MetricsSummary, Device } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'
import {
  CheckCircle2, XCircle, AlertTriangle, HelpCircle,
  Server, RefreshCw, TrendingUp
} from 'lucide-react'
import clsx from 'clsx'

function StatCard({
  label, value, icon: Icon, color, sub
}: {
  label: string
  value: number | string
  icon: React.ElementType
  color: string
  sub?: string
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className={clsx('text-3xl font-bold mt-1', color)}>{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={clsx('p-2.5 rounded-xl', color.replace('text-', 'bg-').replace('-700', '-100').replace('-600', '-100'))}>
          <Icon size={22} className={color} />
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    up: 'badge-up',
    down: 'badge-down',
    degraded: 'badge-degraded',
    unknown: 'badge-unknown',
  }
  const labels: Record<string, string> = {
    up: 'Online', down: 'Offline', degraded: 'Degradado', unknown: 'Desconhecido'
  }
  return <span className={map[status] || 'badge-unknown'}>{labels[status] || status}</span>
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const { deviceStatuses } = useWebSocket()

  const load = async () => {
    setLoading(true)
    try {
      const [s, d] = await Promise.all([metricsApi.summary(), devicesApi.list()])
      setSummary(s)
      setDevices(d)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Merge real-time statuses
  const mergedDevices = devices.map(d => ({
    ...d,
    status: (deviceStatuses[String(d.id)]?.status ?? d.status),
  }))

  const liveSummary = {
    up: mergedDevices.filter(d => d.status === 'up').length,
    down: mergedDevices.filter(d => d.status === 'down').length,
    degraded: mergedDevices.filter(d => d.status === 'degraded').length,
    unknown: mergedDevices.filter(d => d.status === 'unknown').length,
    total: mergedDevices.length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Visão geral da infraestrutura de rede</p>
        </div>
        <button onClick={load} className="btn-secondary" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total de Dispositivos"
          value={liveSummary.total}
          icon={Server}
          color="text-slate-700"
        />
        <StatCard
          label="Online"
          value={liveSummary.up}
          icon={CheckCircle2}
          color="text-emerald-600"
          sub={liveSummary.total > 0 ? `${Math.round(liveSummary.up / liveSummary.total * 100)}% disponível` : undefined}
        />
        <StatCard
          label="Offline"
          value={liveSummary.down}
          icon={XCircle}
          color="text-red-600"
        />
        <StatCard
          label="Degradados"
          value={liveSummary.degraded + liveSummary.unknown}
          icon={AlertTriangle}
          color="text-amber-600"
        />
      </div>

      {/* Health bar */}
      {liveSummary.total > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Saúde da Rede</span>
            </div>
            <span className="text-sm font-bold text-slate-900">
              {Math.round(liveSummary.up / liveSummary.total * 100)}%
            </span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 transition-all duration-700"
              style={{ width: `${liveSummary.up / liveSummary.total * 100}%` }}
            />
            <div
              className="bg-amber-400 transition-all duration-700"
              style={{ width: `${liveSummary.degraded / liveSummary.total * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-700"
              style={{ width: `${liveSummary.down / liveSummary.total * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Online</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Degradado</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Offline</span>
          </div>
        </div>
      )}

      {/* Device list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Dispositivos</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : mergedDevices.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            Nenhum dispositivo cadastrado. Acesse <strong>Dispositivos</strong> para adicionar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">IP</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Fabricante</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Último Contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {mergedDevices.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{d.name}</td>
                    <td className="px-5 py-3 font-mono text-slate-600">{d.ip_address}</td>
                    <td className="px-5 py-3 text-slate-600 capitalize">{d.device_type}</td>
                    <td className="px-5 py-3 text-slate-600 capitalize">{d.vendor}</td>
                    <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {d.last_seen
                        ? new Date(d.last_seen).toLocaleString('pt-BR')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
