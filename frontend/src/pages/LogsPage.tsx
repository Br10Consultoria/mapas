import { useEffect, useState, useRef, useCallback } from 'react'
import { logsApi, diagnosticsApi, EventLog, LogLevel, PingResult } from '../services/api'
import {
  RefreshCw, Trash2, Search, Filter, Wifi, WifiOff,
  CheckCircle, AlertTriangle, XCircle, Info, Activity,
  Terminal, ChevronDown, ChevronUp, Play
} from 'lucide-react'
import clsx from 'clsx'

// ── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  success: { label: 'Sucesso',  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle size={13} /> },
  info:    { label: 'Info',     color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',       icon: <Info size={13} /> },
  warning: { label: 'Aviso',   color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     icon: <AlertTriangle size={13} /> },
  error:   { label: 'Erro',    color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         icon: <XCircle size={13} /> },
  debug:   { label: 'Debug',   color: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200',     icon: <Terminal size={13} /> },
}

const CATEGORY_LABELS: Record<string, string> = {
  snmp: 'SNMP', ping: 'Ping', topology: 'Topologia',
  system: 'Sistema', api: 'API', poller: 'Poller',
}

function LogBadge({ level }: { level: LogLevel }) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG.info
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color, cfg.bg)}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

function LogRow({ log }: { log: EventLog }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info
  return (
    <div className={clsx('border-b border-slate-100 last:border-0', log.level === 'error' && 'bg-red-50/30')}>
      <div
        className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer select-none"
        onClick={() => log.detail && setExpanded(v => !v)}
      >
        <span className={clsx('mt-0.5 shrink-0', cfg.color)}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <LogBadge level={log.level} />
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">
              {CATEGORY_LABELS[log.category] || log.category}
            </span>
            {log.device_name && (
              <span className="text-xs font-medium text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
                {log.device_name}
              </span>
            )}
            <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
              {new Date(log.created_at).toLocaleString('pt-BR')}
            </span>
          </div>
          <p className="text-sm text-slate-700">{log.message}</p>
        </div>
        {log.detail && (
          <span className="text-slate-400 shrink-0 mt-0.5">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </div>
      {expanded && log.detail && (
        <div className="px-4 pb-3">
          <pre className="text-xs bg-slate-900 text-green-400 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
            {log.detail}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Ping Tool ─────────────────────────────────────────────────────────────────

function PingTool() {
  const [host, setHost] = useState('')
  const [count, setCount] = useState(4)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PingResult | null>(null)

  const handlePing = async () => {
    if (!host.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const r = await diagnosticsApi.ping(host.trim(), count)
      setResult(r)
    } catch (e) {
      setResult({ host, reachable: false, packet_loss: 100, output: 'Erro ao executar ping' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
        <Activity size={16} className="text-primary-600" />
        Ferramenta de Ping
      </h3>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={host}
          onChange={e => setHost(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePing()}
          placeholder="IP ou hostname..."
          className="input flex-1"
        />
        <select
          value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="input w-20"
        >
          {[1, 4, 10, 20].map(n => <option key={n} value={n}>{n}x</option>)}
        </select>
        <button
          onClick={handlePing}
          disabled={loading || !host.trim()}
          className="btn-primary"
        >
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? 'Pingando...' : 'Ping'}
        </button>
      </div>

      {result && (
        <div className={clsx(
          'rounded-lg border p-3',
          result.reachable ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
        )}>
          <div className="flex items-center gap-2 mb-2">
            {result.reachable
              ? <Wifi size={16} className="text-emerald-600" />
              : <WifiOff size={16} className="text-red-600" />}
            <span className={clsx('font-semibold text-sm', result.reachable ? 'text-emerald-700' : 'text-red-700')}>
              {result.host} — {result.reachable ? 'ACESSÍVEL' : 'INACESSÍVEL'}
            </span>
          </div>
          {result.reachable && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[
                { label: 'Mín', value: result.min_ms != null ? `${result.min_ms.toFixed(1)} ms` : '—' },
                { label: 'Méd', value: result.avg_ms != null ? `${result.avg_ms.toFixed(1)} ms` : '—' },
                { label: 'Máx', value: result.max_ms != null ? `${result.max_ms.toFixed(1)} ms` : '—' },
                { label: 'Perda', value: `${result.packet_loss.toFixed(0)}%` },
              ].map(s => (
                <div key={s.label} className="bg-white rounded p-2 text-center border border-slate-100">
                  <div className="text-xs text-slate-500">{s.label}</div>
                  <div className="font-mono font-semibold text-slate-800 text-sm">{s.value}</div>
                </div>
              ))}
            </div>
          )}
          <pre className="text-xs bg-slate-900 text-green-400 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [logs, setLogs] = useState<EventLog[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [search, setSearch] = useState('')
  const [filterLevel, setFilterLevel] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const params: Record<string, string | number> = { limit: 300 }
      if (filterLevel) params.level = filterLevel
      if (filterCategory) params.category = filterCategory
      const data = await logsApi.list(params)
      setLogs(data)
    } catch (e) {
      // silent
    } finally {
      setLoading(false)
    }
  }, [filterLevel, filterCategory])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchLogs])

  const handleClear = async () => {
    if (!confirm('Limpar todos os logs?')) return
    await logsApi.clear()
    setLogs([])
  }

  const filtered = logs.filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.message.toLowerCase().includes(q) ||
      (l.device_name || '').toLowerCase().includes(q) ||
      (l.detail || '').toLowerCase().includes(q)
    )
  })

  const counts = {
    error: logs.filter(l => l.level === 'error').length,
    warning: logs.filter(l => l.level === 'warning').length,
    success: logs.filter(l => l.level === 'success').length,
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Logs do Sistema</h1>
          <p className="text-slate-500 text-sm mt-0.5">{logs.length} eventos registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={clsx('btn', autoRefresh ? 'btn-primary' : 'btn-secondary')}
          >
            <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} />
            {autoRefresh ? 'Auto (5s)' : 'Auto Off'}
          </button>
          <button onClick={fetchLogs} className="btn-secondary">
            <RefreshCw size={14} />
            Atualizar
          </button>
          <button onClick={handleClear} className="btn-danger">
            <Trash2 size={14} />
            Limpar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Erros', count: counts.error, color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: <XCircle size={18} /> },
          { label: 'Avisos', count: counts.warning, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: <AlertTriangle size={18} /> },
          { label: 'Sucessos', count: counts.success, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle size={18} /> },
        ].map(c => (
          <div key={c.label} className={clsx('rounded-xl border p-4 flex items-center gap-3', c.bg)}>
            <span className={c.color}>{c.icon}</span>
            <div>
              <div className={clsx('text-2xl font-bold', c.color)}>{c.count}</div>
              <div className="text-xs text-slate-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Log list */}
        <div className="xl:col-span-2 space-y-3">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-48">
              <Search size={14} className="text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar mensagem, dispositivo..."
                className="input flex-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-slate-400" />
              <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className="input text-sm">
                <option value="">Todos os níveis</option>
                {Object.entries(LEVEL_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="input text-sm">
              <option value="">Todas as categorias</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Log entries */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-slate-400">
                <RefreshCw size={20} className="animate-spin mr-2" /> Carregando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <Terminal size={32} className="mb-2 opacity-30" />
                <p className="text-sm">Nenhum log encontrado</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {filtered.map(log => <LogRow key={log.id} log={log} />)}
              </div>
            )}
          </div>
        </div>

        {/* Ping tool */}
        <div>
          <PingTool />
        </div>
      </div>
    </div>
  )
}
