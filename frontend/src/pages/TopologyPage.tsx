import { useEffect, useRef, useState, useCallback } from 'react'
import { topologyApi, devicesApi, Topology, Device, TopologyEdge } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'
import NetworkMap from '../components/map/NetworkMap'
import {
  RefreshCw, Search, Server, Network, X, Play,
  Link2, Trash2, Upload, Image, Plus
} from 'lucide-react'
import clsx from 'clsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000)     return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000)         return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

// ── Device Panel ──────────────────────────────────────────────────────────────

function DevicePanel({
  deviceId,
  onClose,
  onImageUpdated,
}: {
  deviceId: string
  onClose: () => void
  onImageUpdated?: () => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [polling, setPolling] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !device) return
    setUploading(true)
    try {
      const updated = await devicesApi.uploadImage(device.id, file)
      setDevice(updated)
      onImageUpdated?.()
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao fazer upload da imagem.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleImageDelete = async () => {
    if (!device || !device.image_url) return
    if (!confirm('Remover imagem personalizada?')) return
    try {
      const updated = await devicesApi.deleteImage(device.id)
      setDevice(updated)
      onImageUpdated?.()
    } catch (err) {
      console.error(err)
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
        {/* Imagem do dispositivo */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Ícone do Dispositivo
          </p>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl border-2 border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {device.image_url ? (
                <img
                  src={device.image_url}
                  alt={device.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Image size={24} className="text-slate-300" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn-secondary text-xs py-1 px-2"
              >
                <Upload size={12} />
                {uploading ? 'Enviando...' : 'Upload'}
              </button>
              {device.image_url && (
                <button
                  onClick={handleImageDelete}
                  className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                  <Trash2 size={11} />
                  Remover
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1.5">JPG, PNG, GIF, WebP ou SVG</p>
        </div>

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
              {device.interfaces.slice(0, 12).map(iface => (
                <div
                  key={iface.id}
                  className={clsx(
                    'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs',
                    iface.if_oper_status === 1 ? 'bg-emerald-50' : 'bg-slate-50'
                  )}
                >
                  <span className="font-mono text-slate-700 truncate">{iface.if_name}</span>
                  <span className={clsx(
                    'flex-shrink-0 font-medium ml-2',
                    iface.if_oper_status === 1 ? 'text-emerald-600' : 'text-slate-400'
                  )}>
                    {iface.if_oper_status === 1 ? 'Up' : 'Down'}
                  </span>
                </div>
              ))}
              {device.interfaces.length > 12 && (
                <p className="text-xs text-slate-400 text-center">
                  +{device.interfaces.length - 12} interfaces
                </p>
              )}
            </div>
          </div>
        )}

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

// ── Link Panel ────────────────────────────────────────────────────────────────

function LinkPanel({
  edge,
  linkTraffic,
  onClose,
  onDelete,
}: {
  edge: TopologyEdge
  linkTraffic: Record<string, { in_bps: number; out_bps: number }>
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const traffic = linkTraffic[edge.id]

  return (
    <div className="w-72 flex-shrink-0 card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-800">Detalhes do Link</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-3 text-sm">
        {edge.source_interface && (
          <div className="flex justify-between">
            <span className="text-slate-500">Porta Origem</span>
            <span className="font-mono text-slate-800 text-xs">{edge.source_interface}</span>
          </div>
        )}
        {edge.target_interface && (
          <div className="flex justify-between">
            <span className="text-slate-500">Porta Destino</span>
            <span className="font-mono text-slate-800 text-xs">{edge.target_interface}</span>
          </div>
        )}
        {edge.bandwidth && (
          <div className="flex justify-between">
            <span className="text-slate-500">Capacidade</span>
            <span className="font-medium text-slate-800">{formatBps(edge.bandwidth)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500">Descoberto via</span>
          <span className={clsx(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            edge.discovered_via === 'lldp'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-violet-100 text-violet-700'
          )}>
            {edge.discovered_via?.toUpperCase() || 'MANUAL'}
          </span>
        </div>

        {/* Tráfego em tempo real */}
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Tráfego em Tempo Real
          </p>
          {traffic ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 flex items-center gap-1">
                  <span className="text-emerald-500">↓</span> Entrada
                </span>
                <span className="font-semibold text-emerald-600">{formatBps(traffic.in_bps)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 flex items-center gap-1">
                  <span className="text-blue-500">↑</span> Saída
                </span>
                <span className="font-semibold text-blue-600">{formatBps(traffic.out_bps)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-500">Total</span>
                <span className="font-bold text-slate-800">
                  {formatBps(traffic.in_bps + traffic.out_bps)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Aguardando dados de tráfego...</p>
          )}
        </div>
      </div>

      <div className="p-3 border-t border-slate-100">
        <button
          onClick={() => onDelete(edge.id)}
          className="btn w-full justify-center text-red-600 border border-red-200 hover:bg-red-50"
        >
          <Trash2 size={14} />
          Remover Link
        </button>
      </div>
    </div>
  )
}

// ── Create Link Modal ─────────────────────────────────────────────────────────

function CreateLinkModal({
  devices,
  onClose,
  onCreated,
}: {
  devices: Device[]
  onClose: () => void
  onCreated: () => void
}) {
  const [srcDevice, setSrcDevice] = useState<number | ''>('')
  const [tgtDevice, setTgtDevice] = useState<number | ''>('')
  const [srcIface, setSrcIface] = useState<number | ''>('')
  const [tgtIface, setTgtIface] = useState<number | ''>('')
  const [bandwidth, setBandwidth] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const srcDeviceObj = devices.find(d => d.id === srcDevice)
  const tgtDeviceObj = devices.find(d => d.id === tgtDevice)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!srcDevice || !tgtDevice) { setError('Selecione os dois dispositivos.'); return }
    if (srcDevice === tgtDevice) { setError('Dispositivos devem ser diferentes.'); return }
    setLoading(true)
    setError('')
    try {
      await topologyApi.createLink({
        source_device_id: Number(srcDevice),
        target_device_id: Number(tgtDevice),
        source_interface_id: srcIface !== '' ? Number(srcIface) : undefined,
        target_interface_id: tgtIface !== '' ? Number(tgtIface) : undefined,
        bandwidth: bandwidth ? Number(bandwidth) * 1_000_000 : undefined,
      })
      onCreated()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erro ao criar link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-primary-600" />
            <h2 className="text-base font-bold text-slate-900">Criar Link Manual</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Dispositivo Origem */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Dispositivo Origem *
            </label>
            <select
              value={srcDevice}
              onChange={e => { setSrcDevice(Number(e.target.value)); setSrcIface('') }}
              className="input w-full"
              required
            >
              <option value="">Selecione...</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
              ))}
            </select>
          </div>

          {/* Interface Origem */}
          {srcDeviceObj && srcDeviceObj.interfaces.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Porta / Interface Origem
              </label>
              <select
                value={srcIface}
                onChange={e => setSrcIface(e.target.value ? Number(e.target.value) : '')}
                className="input w-full"
              >
                <option value="">Nenhuma (link genérico)</option>
                {srcDeviceObj.interfaces.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.if_name}{i.if_alias ? ` — ${i.if_alias}` : ''}
                    {i.if_oper_status === 1 ? ' ✓' : ' ✗'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dispositivo Destino */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Dispositivo Destino *
            </label>
            <select
              value={tgtDevice}
              onChange={e => { setTgtDevice(Number(e.target.value)); setTgtIface('') }}
              className="input w-full"
              required
            >
              <option value="">Selecione...</option>
              {devices.filter(d => d.id !== srcDevice).map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
              ))}
            </select>
          </div>

          {/* Interface Destino */}
          {tgtDeviceObj && tgtDeviceObj.interfaces.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Porta / Interface Destino
              </label>
              <select
                value={tgtIface}
                onChange={e => setTgtIface(e.target.value ? Number(e.target.value) : '')}
                className="input w-full"
              >
                <option value="">Nenhuma (link genérico)</option>
                {tgtDeviceObj.interfaces.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.if_name}{i.if_alias ? ` — ${i.if_alias}` : ''}
                    {i.if_oper_status === 1 ? ' ✓' : ' ✗'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Capacidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Capacidade do Link (Mbps)
            </label>
            <input
              type="number"
              value={bandwidth}
              onChange={e => setBandwidth(e.target.value)}
              placeholder="Ex: 1000 para 1 Gbps"
              className="input w-full"
              min={1}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              <Link2 size={14} />
              {loading ? 'Criando...' : 'Criar Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TopologyPage() {
  const [topology, setTopology] = useState<Topology>({ nodes: [], edges: [] })
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<TopologyEdge | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [showCreateLink, setShowCreateLink] = useState(false)
  const { deviceStatuses, linkTraffic } = useWebSocket()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, d] = await Promise.all([topologyApi.get(), devicesApi.list()])
      setTopology(t)
      setDevices(d)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      await topologyApi.discover()
      setTimeout(load, 3000)
    } finally {
      setTimeout(() => setDiscovering(false), 3000)
    }
  }

  const handleEdgeClick = useCallback((edgeId: string) => {
    const edge = topology.edges.find(e => e.id === edgeId)
    if (edge) {
      setSelectedNode(null)
      setSelectedEdge(edge)
    }
  }, [topology.edges])

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedEdge(null)
    setSelectedNode(nodeId)
  }, [])

  const handleDeleteLink = async (edgeId: string) => {
    if (!confirm('Remover este link?')) return
    try {
      await topologyApi.deleteLink(Number(edgeId))
      setSelectedEdge(null)
      load()
    } catch (err) {
      console.error(err)
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
            onClick={() => setShowCreateLink(true)}
            className="btn-primary"
          >
            <Plus size={15} />
            Criar Link
          </button>
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
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 flex-shrink-0">
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
        <span className="ml-2 font-medium text-slate-600">Tráfego:</span>
        {[
          { label: 'Baixo', color: '#60a5fa' },
          { label: 'Médio', color: '#22c55e' },
          { label: 'Alto', color: '#f59e0b' },
          { label: 'Crítico', color: '#ef4444' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-5 h-1 rounded inline-block" style={{ backgroundColor: color }} />
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
              linkTraffic={linkTraffic}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
            />
          )}
        </div>

        {/* Side panel: device ou link */}
        {selectedNode && (
          <DevicePanel
            deviceId={selectedNode}
            onClose={() => setSelectedNode(null)}
            onImageUpdated={load}
          />
        )}
        {selectedEdge && !selectedNode && (
          <LinkPanel
            edge={selectedEdge}
            linkTraffic={linkTraffic}
            onClose={() => setSelectedEdge(null)}
            onDelete={handleDeleteLink}
          />
        )}
      </div>

      {/* Modal criar link */}
      {showCreateLink && (
        <CreateLinkModal
          devices={devices}
          onClose={() => setShowCreateLink(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}
