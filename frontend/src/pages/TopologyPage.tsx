import { useEffect, useRef, useState, useCallback } from 'react'
import { topologyApi, devicesApi, Topology, Device } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'
import NetworkMap from '../components/map/NetworkMap'
import {
  RefreshCw, Search,
  Server, Network, X, Play
} from 'lucide-react'
import clsx from 'clsx'

function DevicePanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const [device, setDevice] = useState<Device | null>(null)
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    devicesApi.get(Number(deviceId)).then(setDevice).catch(console.error)
  }, [deviceId])

  const handlePoll = async () => {
    setPolling(true)
    try {
      const updated = await devicesApi.poll(Number(deviceId))
      setDevice(updated)
    } finally {
      setPolling(false)
    }
  }

  if (!device) return null

  const statusColors: Record<string, string> = {
    up: 'text-emerald-600', down: 'text-red-600',
    degraded: 'text-amber-600', unknown: 'text-slate-400',
  }
  const statusLabels: Record<string, string> = {
    up: 'Online', down: 'Offline', degraded: 'Degradado', unknown: 'Desconhecido',
  }

  return (
    <div className="w-80 flex-shrink-0 card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-800 truncate">{device.name}</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Status</span>
          <span className={clsx('font-semibold', statusColors[device.status])}>
            {statusLabels[device.status]}
          </span>
        </div>

        {/* Info */}
        <div className="space-y-2">
          {[
            ['IP', device.ip_address],
            ['Hostname', device.hostname],
            ['Tipo', device.device_type],
            ['Fabricante', device.vendor],
            ['Modelo', device.model],
            ['Localização', device.location],
          ].map(([label, value]) => value ? (
            <div key={label} className="flex justify-between gap-2">
              <span className="text-slate-500 flex-shrink-0">{label}</span>
              <span className="text-slate-800 font-medium text-right truncate capitalize">{value}</span>
            </div>
          ) : null)}
        </div>

        {/* Interfaces */}
        {device.interfaces.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Interfaces ({device.interfaces.length})
            </p>
            <div className="space-y-1.5">
              {device.interfaces.slice(0, 10).map(iface => (
                <div
                  key={iface.id}
                  className={clsx(
                    'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs',
                    iface.if_oper_status === 1 ? 'bg-emerald-50' : 'bg-slate-50'
                  )}
                >
                  <span className="font-mono text-slate-700 truncate">{iface.if_name}</span>
                  <span className={clsx(
                    'flex-shrink-0 font-medium',
                    iface.if_oper_status === 1 ? 'text-emerald-600' : 'text-slate-400'
                  )}>
                    {iface.if_oper_status === 1 ? 'Up' : 'Down'}
                  </span>
                </div>
              ))}
              {device.interfaces.length > 10 && (
                <p className="text-xs text-slate-400 text-center">
                  +{device.interfaces.length - 10} interfaces
                </p>
              )}
            </div>
          </div>
        )}

        {/* Last seen */}
        {device.last_seen && (
          <div className="text-xs text-slate-400">
            Último contato: {new Date(device.last_seen).toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-slate-100">
        <button
          onClick={handlePoll}
          disabled={polling}
          className="btn-primary w-full justify-center"
        >
          <Play size={14} className={polling ? 'animate-spin' : ''} />
          {polling ? 'Consultando...' : 'Consultar Agora'}
        </button>
      </div>
    </div>
  )
}

export default function TopologyPage() {
  const [topology, setTopology] = useState<Topology>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const { deviceStatuses } = useWebSocket()

  const load = async () => {
    setLoading(true)
    try {
      const t = await topologyApi.get()
      setTopology(t)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      await topologyApi.discover()
      setTimeout(load, 3000) // reload after 3s
    } finally {
      setTimeout(() => setDiscovering(false), 3000)
    }
  }

  const mapContainerRef = useRef<HTMLDivElement>(null)

  const handlePositionChange = useCallback(async (e: Event) => {
    const { id, x, y } = (e as CustomEvent).detail
    try {
      await devicesApi.updatePosition(Number(id), x, y)
    } catch (err) {
      console.error('Failed to save position', err)
    }
  }, [])

  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    el.addEventListener('nodePositionChanged', handlePositionChange)
    return () => el.removeEventListener('nodePositionChanged', handlePositionChange)
  }, [handlePositionChange])

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa de Rede</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {topology.nodes.length} dispositivos · {topology.edges.length} links
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="btn-secondary"
          >
            <Search size={15} className={discovering ? 'animate-spin' : ''} />
            {discovering ? 'Descobrindo...' : 'Descoberta LLDP'}
          </button>
          <button onClick={load} className="btn-secondary" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Recarregar
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500 flex-shrink-0">
        <span className="font-medium text-slate-600">Fabricantes:</span>
        {[
          { label: 'Huawei', color: '#cf0a2c' },
          { label: 'MikroTik', color: '#e05206' },
          { label: 'Datacom', color: '#1a56db' },
          { label: 'Cisco', color: '#1ba0d7' },
          { label: 'Genérico', color: '#64748b' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
        <span className="ml-2 font-medium text-slate-600">Status (borda):</span>
        {[
          { label: 'Online', color: '#10b981' },
          { label: 'Offline', color: '#ef4444' },
          { label: 'Degradado', color: '#f59e0b' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full inline-block border-2" style={{ borderColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Map + Panel */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Map */}
        <div
          ref={mapContainerRef}
          className="flex-1 card overflow-hidden relative"
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white">
              <div className="text-center">
                <RefreshCw size={32} className="animate-spin text-primary-500 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Carregando topologia...</p>
              </div>
            </div>
          ) : topology.nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white">
              <div className="text-center max-w-sm">
                <Network size={48} className="text-slate-200 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">Nenhum dispositivo no mapa</p>
                <p className="text-sm text-slate-400 mt-1">
                  Adicione dispositivos na aba <strong>Dispositivos</strong> e execute a descoberta LLDP.
                </p>
              </div>
            </div>
          ) : (
            <NetworkMap
              topology={topology}
              deviceStatuses={deviceStatuses}
              onNodeClick={setSelectedNode}
            />
          )}
        </div>

        {/* Side panel */}
        {selectedNode && (
          <DevicePanel
            deviceId={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  )
}
