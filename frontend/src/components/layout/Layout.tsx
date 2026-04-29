import { Outlet, NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Network, Server, Wifi, WifiOff, Activity
} from 'lucide-react'
import { useWebSocket } from '../../hooks/useWebSocket'
import clsx from 'clsx'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/topology',  icon: Network,          label: 'Mapa de Rede' },
  { to: '/devices',   icon: Server,            label: 'Dispositivos' },
]

export default function Layout() {
  const { connected } = useWebSocket()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-200">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <Network size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-none">NetMap</p>
            <p className="text-xs text-slate-400 mt-0.5">Mapa de Redes</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Connection status */}
        <div className="p-4 border-t border-slate-200">
          <div className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
            connected ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          )}>
            {connected
              ? <><Wifi size={14} /> Tempo real ativo</>
              : <><WifiOff size={14} /> Reconectando...</>
            }
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-slate-400" />
            <span className="text-sm text-slate-500">Monitoramento de Infraestrutura de Rede</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {new Date().toLocaleDateString('pt-BR', {
                weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
              })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
