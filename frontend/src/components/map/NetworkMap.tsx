import { useRef, useEffect, useCallback } from 'react'
import cytoscape, { Core, NodeSingular, ElementDefinition, Stylesheet } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { Topology, DeviceStatus, DeviceType, DeviceVendor } from '../../services/api'

cytoscape.use(fcose)

// ── Status & vendor colors ────────────────────────────────────────────────────

const STATUS_COLOR: Record<DeviceStatus, string> = {
  up:       '#10b981',
  down:     '#ef4444',
  degraded: '#f59e0b',
  unknown:  '#94a3b8',
}

const VENDOR_BG: Record<DeviceVendor | string, string> = {
  huawei:   '#fef2f2',
  mikrotik: '#fff7ed',
  datacom:  '#eff6ff',
  cisco:    '#f0f9ff',
  generic:  '#f8fafc',
}

const VENDOR_BORDER: Record<DeviceVendor | string, string> = {
  huawei:   '#cf0a2c',
  mikrotik: '#e05206',
  datacom:  '#1a56db',
  cisco:    '#1ba0d7',
  generic:  '#64748b',
}

// ── SVG icons encoded as data URIs ────────────────────────────────────────────

function svgUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Router icon (circle with arrows)
const ROUTER_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="32" fill="${color}" fill-opacity="0.15"/>
  <circle cx="32" cy="32" r="14" stroke="${color}" stroke-width="2.5" fill="white"/>
  <path d="M32 18v4M32 42v4M18 32h4M42 32h4" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="5" fill="${color}"/>
  <path d="M24 24l3 3M37 37l3 3M24 40l3-3M37 27l3-3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`)

// Switch icon (rectangle with ports)
const SWITCH_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="8" y="20" width="48" height="24" rx="4" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <rect x="14" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="22" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="30" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <rect x="38" y="26" width="5" height="8" rx="1" fill="${color}"/>
  <circle cx="50" cy="30" r="3" fill="${color}"/>
</svg>`)

// Firewall icon (shield)
const FIREWALL_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <path d="M32 8L12 18v16c0 11 9 20 20 22 11-2 20-11 20-22V18L32 8z" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <path d="M26 32l4 4 8-8" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`)

// Server icon
const SERVER_SVG = (color: string) => svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="12" y="12" width="40" height="16" rx="3" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <rect x="12" y="36" width="40" height="16" rx="3" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
  <circle cx="48" cy="20" r="3" fill="${color}"/>
  <circle cx="48" cy="44" r="3" fill="${color}"/>
  <rect x="18" y="17" width="16" height="6" rx="1.5" fill="${color}" fill-opacity="0.4"/>
  <rect x="18" y="41" width="16" height="6" rx="1.5" fill="${color}" fill-opacity="0.4"/>
</svg>`)

// Generic/unknown icon
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface NetworkMapProps {
  topology: Topology
  deviceStatuses: Record<string, { status: DeviceStatus }>
  onNodeClick?: (nodeId: string) => void
  onEdgeClick?: (edgeId: string) => void
}

export default function NetworkMap({
  topology,
  deviceStatuses,
  onNodeClick,
  onEdgeClick,
}: NetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  const buildElements = useCallback((): ElementDefinition[] => {
    const nodes: ElementDefinition[] = topology.nodes.map(node => {
      const liveStatus = deviceStatuses[node.id]?.status ?? node.status
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
          bgColor: VENDOR_BG[node.vendor] ?? VENDOR_BG.generic,
          borderColor: VENDOR_BORDER[node.vendor] ?? VENDOR_BORDER.generic,
          icon: getNodeIcon(node.device_type, node.vendor),
        },
        position: node.pos_x != null && node.pos_y != null
          ? { x: node.pos_x, y: node.pos_y }
          : undefined,
      }
    })

    const edges: ElementDefinition[] = topology.edges.map(edge => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        source_interface: edge.source_interface || '',
        target_interface: edge.target_interface || '',
        bandwidth: edge.bandwidth,
        discovered_via: edge.discovered_via || 'manual',
        label: edge.source_interface && edge.target_interface
          ? `${edge.source_interface} ↔ ${edge.target_interface}`
          : '',
      },
    }))

    return [...nodes, ...edges]
  }, [topology, deviceStatuses])

  useEffect(() => {
    if (!containerRef.current) return

    const stylesheet: Stylesheet[] = [
      {
        selector: 'node',
        style: {
          'background-color': 'data(bgColor)',
          'background-image': 'data(icon)',
          'background-fit': 'contain',
          'background-clip': 'none',
          'border-width': 3,
          'border-color': 'data(statusColor)',
          'label': 'data(label)',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'font-size': '11px',
          'font-family': 'Inter, system-ui, sans-serif',
          'font-weight': 600,
          'color': '#1e293b',
          'text-margin-y': 6,
          'width': 56,
          'height': 56,
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.9,
          'text-background-padding': '3px',
          'text-background-shape': 'roundrectangle',
          'overlay-padding': '6px',
          'shadow-blur': 8,
          'shadow-color': '#00000020',
          'shadow-offset-x': 0,
          'shadow-offset-y': 2,
          'shadow-opacity': 0.15,
        },
      },
      {
        selector: 'node[device_type = "router"]',
        style: { 'shape': 'ellipse', 'width': 60, 'height': 60 },
      },
      {
        selector: 'node[device_type = "switch"]',
        style: { 'shape': 'round-rectangle', 'width': 64, 'height': 52 },
      },
      {
        selector: 'node[device_type = "firewall"]',
        style: { 'shape': 'diamond', 'width': 60, 'height': 60 },
      },
      {
        selector: 'node[status = "down"]',
        style: {
          'opacity': 0.55,
          'border-style': 'dashed',
          'border-width': 3,
        },
      },
      {
        selector: 'node[status = "degraded"]',
        style: {
          'border-width': 4,
          'border-style': 'dotted',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 5,
          'border-color': '#2563eb',
          'shadow-blur': 16,
          'shadow-color': '#2563eb40',
          'shadow-opacity': 0.5,
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#cbd5e1',
          'target-arrow-shape': 'none',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '9px',
          'color': '#64748b',
          'text-rotation': 'autorotate',
          'text-background-color': '#f8fafc',
          'text-background-opacity': 0.9,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
        },
      },
      {
        selector: 'edge[discovered_via = "lldp"]',
        style: { 'line-color': '#60a5fa', 'width': 2.5 },
      },
      {
        selector: 'edge[discovered_via = "manual"]',
        style: { 'line-color': '#a78bfa', 'line-style': 'dashed' },
      },
      {
        selector: 'edge:selected',
        style: { 'line-color': '#2563eb', 'width': 3.5 },
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
        padding: 60,
        fit: true,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
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

  // Real-time status updates without full re-render
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

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-xl bg-white"
      style={{ minHeight: 500 }}
    />
  )
}
