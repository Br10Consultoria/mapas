import { useEffect, useRef, useState, useCallback } from 'react'

export interface WsDeviceStatus {
  id: string
  status: 'up' | 'down' | 'degraded' | 'unknown'
  last_seen?: string
  uptime?: number
}

export interface WsLinkTraffic {
  link_id: string
  in_bps: number
  out_bps: number
}

export type WsMessage =
  | { type: 'device_status'; timestamp: string; data: WsDeviceStatus[] }
  | { type: 'link_traffic'; timestamp: string; data: WsLinkTraffic[] }

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null)
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, WsDeviceStatus>>({})
  const [linkTraffic, setLinkTraffic] = useState<Record<string, WsLinkTraffic>>({})
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/api/v1/metrics/ws`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        setLastMessage(msg)
        if (msg.type === 'device_status') {
          setDeviceStatuses(prev => {
            const next = { ...prev }
            msg.data.forEach(d => { next[d.id] = d })
            return next
          })
        } else if (msg.type === 'link_traffic') {
          setLinkTraffic(prev => {
            const next = { ...prev }
            msg.data.forEach(t => { next[t.link_id] = t })
            return next
          })
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, lastMessage, deviceStatuses, linkTraffic }
}
