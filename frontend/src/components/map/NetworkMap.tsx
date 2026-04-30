import { useRef, useEffect, useCallback } from 'react'
import cytoscape, { Core, NodeSingular, ElementDefinition, Stylesheet } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { Topology, DeviceStatus, DeviceType, DeviceVendor, TopologyEdge } from '../../services/api'
import { WsLinkTraffic } from '../../hooks/useWebSocket'

cytoscape.use(fcose)

// ── Status & vendor colors ────────────────────────────────────────────────────

const STATUS_COLOR: Record<DeviceStatus, string> = {
  up:       '#10b981',
  down:     '#ef4444',
  degraded: '#f59e0b',
  unknown:  '#94a3b8',
}

const VENDOR_BG: Record<string, string> = {
  huawei:   '#fef2f2',
  mikrotik: '#fff7ed',
  datacom:  '#eff6ff',
  cisco:    '#f0f9ff',
  generic:  '#f8fafc',
}

const VENDOR_BORDER: Record<string, string> = {
  huawei:   '#cf0a2c',
  mikrotik: '#e05206',
  datacom:  '#1a56db',
  cisco:    '#1ba0d7',
  generic:  '#64748b',
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function svgUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const ROUTER_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="32" fill="${color}" fill-opacity="0.15"/>
  <circle cx="32" cy="32" r="14" stroke="${color}" stroke-width="2.5" fill="white"/>
  <path d="M32 18v4M32 42v4M18 32h4M42 32h4" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="5" fill="${color}"/>
  <path d="M24 24l3 3M37 37l3 3M24 40l3-3M37 27l3-3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`)

const SWITCH_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="8" y="20" width="48" height="24" rx="4" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <rect x="14" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="22" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="30" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="38" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <circle cx="50" cy="30" r="3" fill="${color}"/>
</svg>`)

const FIREWALL_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <path d="M32 8L12 18v16c0 11 9 20 20 22 11-2 20-11 20-22V18L32 8z" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <path d="M26 32l4 4 8-8" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`)

const SERVER_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="12" y="12" width="40" height="16" rx="3" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <rect x="12" y="36" width="40" height="16" rx="3" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <circle cx="48" cy="20" r="3" fill="${color}"/>
  <circle cx="48" cy="44" r="3" fill="${color}"/>
  <rect x="18" y="17" width="16" height="6" rx="1.5" fill="${color}" fill-opacity="0.4"/>
  <rect x="18" y="41" width="16" height="6" rx="1.5" fill="${color}" fill-opacity="0.4"/>
</svg>`)

const GENERIC_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="10" y="10" width="44" height="44" rx="8" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <circle cx="32" cy="32" r="8" fill="${color}" fill-opacity="0.5"/>
</svg>`)

function getNodeIcon(device_type: DeviceType, vendor: DeviceVendor | string): string {
  const color = VENDOR_BORDER[vendor] ?? VENDOR_BORDER.generic
  switch (device_type) {
    case 'router':   return ROUTER_SVG(color)
    case 'switch':   return SWITCH_SVG(color)
    case 'firewall': return FIREWALL_SVG(color)
    case 'server':   return SERVER_SVG(color)
    default:         return GENERIC_SVG(color)
  }
}

// ── Traffic color scale ───────────────────────────────────────────────────────

function trafficColor(bps: number): string {
  const mbps = bps / 1_000_000
  if (mbps > 800) return '#ef4444'   // >800 Mbps: vermelho
  if (mbps > 400) return '#f97316'   // >400 Mbps: laranja
  if (mbps > 100) return '#f59e0b'   // >100 Mbps: amarelo
  if (mbps > 10)  return '#22c55e'   // >10 Mbps: verde
  if (mbps > 0)   return '#60a5fa'   // >0: azul claro
  return '#cbd5e1'                   // sem tráfego: cinza
}

function trafficWidth(bps: number): number {
  const mbps = bps / 1_000_000
  if (mbps > 800) return 6
  if (mbps > 100) return 4
  if (mbps > 10)  return 3
  if (mbps > 0)   return 2.5
  return 2
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000)     return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000)         return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NetworkMapProps {
  topology: Topology
  deviceStatuses: Record<string, { status: DeviceStatus }>
  linkTraffic?: Record<string, WsLinkTraffic>
  onNodeClick?: (nodeId: string) => void
  onEdgeClick?: (edgeId: string) => void
}

export default function NetworkMap({
  topology,
  deviceStatuses,
  linkTraffic = {},
  onNodeClick,
  onEdgeClick,
}: NetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  const buildElements = useCallback((): ElementDefinition[] => {
    const nodes: ElementDefinition[] = topology.nodes.map(node => {
      const liveStatus = deviceStatuses[node.id]?.status ?? node.status
      // Use custom image_url if available, otherwise SVG icon
      const imageUrl = (node as any).image_url
      const icon = imageUrl ? imageUrl : getNodeIcon(node.device_type, node.vendor)

      return {
        data: {
          id: node.id,
          label: node.label,
          ip: node.ip_address,
          device_type: node.device_type,
          vendor: node.vendor,
          status: liveStatus,
          model: node.model || '',
          location: node.location || '',
          statusColor: STATUS_COLOR[liveStatus] ?? STATUS_COLOR.unknown,
          bgColor: imageUrl ? '#ffffff' : (VENDOR_BG[node.vendor] ?? VENDOR_BG.generic),
          borderColor: VENDOR_BORDER[node.vendor] ?? VENDOR_BORDER.generic,
          icon,
          hasCustomImage: !!imageUrl,
        },
        position: node.pos_x != null && node.pos_y != null
          ? { x: node.pos_x, y: node.pos_y }
          : undefined,
      }
    })

    const edges: ElementDefinition[] = topology.edges.map((edge: TopologyEdge) => {
      const traffic = linkTraffic[edge.id]
      const totalBps = traffic ? (traffic.in_bps + traffic.out_bps) : 0
      const edgeLabel = buildEdgeLabel(edge, traffic)

      return {
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          source_interface: edge.source_interface || '',
          target_interface: edge.target_interface || '',
          bandwidth: edge.bandwidth,
          discovered_via: edge.discovered_via || 'manual',
          label: edgeLabel,
          trafficColor: trafficColor(totalBps),
          trafficWidth: trafficWidth(totalBps),
          in_bps: traffic?.in_bps ?? 0,
          out_bps: traffic?.out_bps ?? 0,
        },
      }
    })

    return [...nodes, ...edges]
  }, [topology, deviceStatuses, linkTraffic])

  function buildEdgeLabel(edge: TopologyEdge, traffic?: WsLinkTraffic): string {
    const parts: string[] = []
    if (edge.source_interface && edge.target_interface) {
      parts.push(`${edge.source_interface} ↔ ${edge.target_interface}`)
    }
    if (traffic && (traffic.in_bps > 0 || traffic.out_bps > 0)) {
      parts.push(`↓${formatBps(traffic.in_bps)} ↑${formatBps(traffic.out_bps)}`)
    }
    return parts.join('\n')
  }

  useEffect(() => {
    if (!containerRef.current) return

    // Node sizes: metade dos tamanhos originais (56→28, 60→30, 64→32, 52→26)
    const stylesheet: Stylesheet[] = [
      {
        selector: 'node',
        style: {
          'background-color': 'data(bgColor)',
          'background-image': 'data(icon)',
          'background-fit': 'contain',
          'background-clip': 'none',
          'border-width': 2.5,
          'border-color': 'data(statusColor)',
          'label': 'data(label)',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'font-size': '10px',
          'font-family': 'Inter, system-ui, sans-serif',
          'font-weight': 600,
          'color': '#1e293b',
          'text-margin-y': 4,
          'width': 28,
          'height': 28,
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.9,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'overlay-padding': '4px',
        },
      },
      {
        selector: 'node[device_type = "router"]',
        style: { 'shape': 'ellipse', 'width': 30, 'height': 30 },
      },
      {
        selector: 'node[device_type = "switch"]',
        style: { 'shape': 'round-rectangle', 'width': 32, 'height': 26 },
      },
      {
        selector: 'node[device_type = "firewall"]',
        style: { 'shape': 'diamond', 'width': 30, 'height': 30 },
      },
      {
        selector: 'node[status = "down"]',
        style: {
          'opacity': 0.55,
          'border-style': 'dashed',
          'border-width': 2.5,
        },
      },
      {
        selector: 'node[status = "degraded"]',
        style: {
          'border-width': 3,
          'border-style': 'dotted',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 4,
          'border-color': '#2563eb',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 'data(trafficWidth)',
          'line-color': 'data(trafficColor)',
          'target-arrow-shape': 'none',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#475569',
          'text-rotation': 'autorotate',
          'text-background-color': '#f8fafc',
          'text-background-opacity': 0.92,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'text-wrap': 'wrap',
        },
      },
      {
        selector: 'edge[discovered_via = "lldp"]',
        style: { 'line-style': 'solid' },
      },
      {
        selector: 'edge[discovered_via = "manual"]',
        style: { 'line-style': 'dashed' },
      },
      {
        selector: 'edge:selected',
        style: { 'line-color': '#2563eb', 'width': 4 },
      },
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      style: stylesheet,
      layout: {
        name: topology.nodes.some(n => n.pos_x != null) ? 'preset' : 'fcose',
        animate: true,
        animationDuration: 700,
        padding: 80,
        fit: true,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 6,
    })

    cy.on('tap', 'node', (evt) => {
      onNodeClick?.(evt.target.id())
    })
    cy.on('tap', 'edge', (evt) => {
      onEdgeClick?.(evt.target.id())
    })

    cy.on('dragfree', 'node', (evt) => {
      const node = evt.target as NodeSingular
      const pos = node.position()
      containerRef.current?.dispatchEvent(
        new CustomEvent('nodePositionChanged', {
          detail: { id: node.id(), x: pos.x, y: pos.y },
          bubbles: true,
        })
      )
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [topology, buildElements, onNodeClick, onEdgeClick])

  // Real-time status updates (sem re-render completo)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    Object.entries(deviceStatuses).forEach(([id, { status }]) => {
      const node = cy.$(`#${id}`)
      if (node.length) {
        const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
        node.data('status', status)
        node.data('statusColor', color)
        node.style('border-color', color)
        node.style('opacity', status === 'down' ? 0.55 : 1)
        node.style('border-style', status === 'down' ? 'dashed' : 'solid')
      }
    })
  }, [deviceStatuses])

  // Real-time traffic updates nas arestas (sem re-render completo)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    Object.entries(linkTraffic).forEach(([linkId, traffic]) => {
      const edge = cy.$(`#${linkId}`)
      if (edge.length) {
        const totalBps = traffic.in_bps + traffic.out_bps
        const color = trafficColor(totalBps)
        const width = trafficWidth(totalBps)
        edge.data('trafficColor', color)
        edge.data('trafficWidth', width)
        edge.data('in_bps', traffic.in_bps)
        edge.data('out_bps', traffic.out_bps)
        // Atualiza label com tráfego
        const srcIf = edge.data('source_interface')
        const tgtIf = edge.data('target_interface')
        const parts: string[] = []
        if (srcIf && tgtIf) parts.push(`${srcIf} ↔ ${tgtIf}`)
        if (traffic.in_bps > 0 || traffic.out_bps > 0) {
          parts.push(`↓${formatBps(traffic.in_bps)} ↑${formatBps(traffic.out_bps)}`)
        }
        edge.data('label', parts.join('\n'))
        edge.style('line-color', color)
        edge.style('width', width)
      }
    })
  }, [linkTraffic])

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-xl bg-white"
      style={{ minHeight: 500 }}
    />
  )
}
