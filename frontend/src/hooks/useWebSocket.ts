import { useEffect, useRef, useState, useCallback } from 'react'

export interface WsDeviceStatus {
  id: string
  status: 'up' | 'down' | 'degraded' | 'unknown'
  last_seen?: string
  uptime?: number
}

export interface WsMessage {
  type: 'device_status'
  timestamp: string
  data: WsDeviceStatus[]
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null)
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, WsDeviceStatus>>({})
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
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      // Reconnect after 5s
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

  return { connected, lastMessage, deviceStatuses }
}
