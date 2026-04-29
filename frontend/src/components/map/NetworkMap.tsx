import { useEffect, useRef, useCallback } from 'react'
import cytoscape, { Core, NodeSingular, ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { Topology, DeviceStatus } from '../../services/api'

// Register layouts
cytoscape.use(fcose as any)

// Status colors
const STATUS_COLOR: Record<DeviceStatus, string> = {
  up:       '#10b981',
  down:     '#ef4444',
  degraded: '#f59e0b',
  unknown:  '#94a3b8',
}

// Device type icons (SVG paths encoded as background)
const DEVICE_SHAPE: Record<string, string> = {
  router:   'round-rectangle',
  switch:   'rectangle',
  firewall: 'diamond',
  server:   'round-rectangle',
  unknown:  'ellipse',
}

const VENDOR_COLORS: Record<string, string> = {
  huawei:   '#cf0a2c',
  mikrotik: '#e05206',
  datacom:  '#1a56db',
  cisco:    '#1ba0d7',
  generic:  '#64748b',
}

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
          statusColor: STATUS_COLOR[liveStatus] || STATUS_COLOR.unknown,
          vendorColor: VENDOR_COLORS[node.vendor] || VENDOR_COLORS.generic,
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

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(vendorColor)',
            'border-width': 3,
            'border-color': 'data(statusColor)',
            'label': 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'font-size': '11px',
            'font-family': 'Inter, sans-serif',
            'font-weight': '500',
            'color': '#1e293b',
            'text-margin-y': 4,
            'width': 48,
            'height': 48,
            'shape': 'data(device_type)' as any,
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'overlay-padding': '6px',
          },
        },
        {
          selector: 'node[device_type = "router"]',
          style: { 'shape': 'round-rectangle', 'width': 52, 'height': 52 },
        },
        {
          selector: 'node[device_type = "switch"]',
          style: { 'shape': 'rectangle', 'width': 56, 'height': 44 },
        },
        {
          selector: 'node[device_type = "firewall"]',
          style: { 'shape': 'diamond', 'width': 52, 'height': 52 },
        },
        {
          selector: 'node[status = "down"]',
          style: {
            'opacity': 0.6,
            'border-style': 'dashed',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#2563eb',
            'box-shadow': '0 0 0 3px rgba(37,99,235,0.3)',
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
          style: { 'line-color': '#93c5fd', 'width': 2.5 },
        },
        {
          selector: 'edge[discovered_via = "manual"]',
          style: { 'line-color': '#c4b5fd', 'line-style': 'dashed' },
        },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#2563eb', 'width': 3 },
        },
      ],
      layout: {
        name: topology.nodes.some(n => n.pos_x != null) ? 'preset' : 'fcose',
        animate: true,
        animationDuration: 600,
        padding: 40,
        nodeSep: 80,
        edgeSep: 40,
        fit: true,
      } as any,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
    })

    // Events
    cy.on('tap', 'node', (evt) => {
      onNodeClick?.(evt.target.id())
    })
    cy.on('tap', 'edge', (evt) => {
      onEdgeClick?.(evt.target.id())
    })

    // Save positions on drag
    cy.on('dragfree', 'node', (evt) => {
      const node = evt.target as NodeSingular
      const pos = node.position()
      const id = node.id()
      // Dispatch custom event for parent to handle
      containerRef.current?.dispatchEvent(
        new CustomEvent('nodePositionChanged', {
          detail: { id, x: pos.x, y: pos.y },
          bubbles: true,
        })
      )
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [topology])

  // Update statuses without re-rendering
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    Object.entries(deviceStatuses).forEach(([id, { status }]) => {
      const node = cy.$(`#${id}`)
      if (node.length) {
        node.data('status', status)
        node.data('statusColor', STATUS_COLOR[status] || STATUS_COLOR.unknown)
        node.style('border-color', STATUS_COLOR[status] || STATUS_COLOR.unknown)
        if (status === 'down') {
          node.style('opacity', 0.6)
          node.style('border-style', 'dashed')
        } else {
          node.style('opacity', 1)
          node.style('border-style', 'solid')
        }
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
