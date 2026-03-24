import { useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
  Position,
  Handle,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { DependencyGraphNode, DependencyGraph } from '@/hooks/useProjects'

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  done:        { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
  in_progress: { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  testing:     { bg: '#fdf4ff', border: '#d8b4fe', text: '#7e22ce' },
  tz:          { bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
  on_hold:     { bg: '#f9fafb', border: '#d1d5db', text: '#6b7280' },
  planning:    { bg: '#f8fafc', border: '#cbd5e1', text: '#475569' },
}

const PRIORITY_DOT: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

const STATUS_LABEL: Record<string, string> = {
  done:        'Готово',
  in_progress: 'В работе',
  testing:     'Тест',
  tz:          'ТЗ',
  on_hold:     'Пауза',
  planning:    'Планир.',
}

// ── Custom node ───────────────────────────────────────────────────────────────
type TaskNodeData = DependencyGraphNode & Record<string, unknown>

function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  const c = STATUS_COLORS[data.status] ?? STATUS_COLORS.planning
  const dot = PRIORITY_DOT[data.priority]

  return (
    <div
      style={{
        background: c.bg,
        border: `2px solid ${data.is_critical ? '#ef4444' : data.is_overdue ? '#f97316' : c.border}`,
        borderRadius: 10,
        padding: '8px 12px',
        minWidth: 160,
        maxWidth: 220,
        boxShadow: data.is_critical ? '0 0 0 2px #fecaca' : undefined,
        fontSize: 12,
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: c.border }} />
      <Handle type="source" position={Position.Right} style={{ background: c.border }} />

      {dot && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dot,
            marginRight: 6,
            verticalAlign: 'middle',
          }}
        />
      )}
      <span style={{ fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' }}>
        {data.title}
      </span>

      <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span
          style={{
            background: c.border,
            color: c.text,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
        {data.end_date && (
          <span style={{ color: data.is_overdue ? '#ef4444' : '#64748b', fontSize: 10 }}>
            {data.is_overdue ? '⚠ ' : ''}{data.end_date}
          </span>
        )}
      </div>

      {data.assignee_name && (
        <div style={{ marginTop: 3, color: '#64748b', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          👤 {data.assignee_name}
        </div>
      )}

      {data.is_critical && (
        <div style={{ position: 'absolute', top: -8, right: 6, background: '#ef4444', color: '#fff', fontSize: 9, borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>
          КРИТ
        </div>
      )}
    </div>
  )
}

const nodeTypes = { task: TaskNode }

// ── Dagre layout ──────────────────────────────────────────────────────────────
const NODE_W = 220
const NODE_H = 80

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80 })
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

const DEP_LABEL: Record<string, string> = {
  finish_to_start:  'FS',
  start_to_start:   'SS',
  finish_to_finish: 'FF',
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  graph: DependencyGraph
}

export function DependencyGraphView({ graph }: Props) {
  const initialNodes = useMemo<Node<TaskNodeData>[]>(() => {
    if (!graph.nodes.length) return []
    const raw: Node<TaskNodeData>[] = graph.nodes.map((n) => ({
      id: n.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: { ...n },
    }))
    if (!graph.edges.length) {
      return raw.map((n, i) => ({
        ...n,
        position: { x: (i % 4) * 260, y: Math.floor(i / 4) * 120 },
      }))
    }
    const rawEdges: Edge[] = graph.edges.map((e) => ({
      id: `${e.predecessor_id}-${e.successor_id}`,
      source: e.predecessor_id,
      target: e.successor_id,
    }))
    return applyDagreLayout(raw, rawEdges) as Node<TaskNodeData>[]
  }, [graph])

  const initialEdges = useMemo<Edge[]>(() =>
    graph.edges.map((e) => ({
      id: `${e.predecessor_id}-${e.successor_id}`,
      source: e.predecessor_id,
      target: e.successor_id,
      label: e.lag_days > 0
        ? `${DEP_LABEL[e.dependency_type]} +${e.lag_days}д`
        : DEP_LABEL[e.dependency_type],
      labelStyle: { fontSize: 10 },
      labelBgStyle: { fill: '#f8fafc' },
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: { stroke: '#94a3b8' },
    })), [graph])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (!graph.nodes.length) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        В этом проекте нет задач.
      </div>
    )
  }

  return (
    <div style={{ height: 560, width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid hsl(var(--border))' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const status = (n.data as TaskNodeData).status
            return STATUS_COLORS[status]?.border ?? '#cbd5e1'
          }}
          pannable
          zoomable
        />
      </ReactFlow>
      <div className="flex gap-4 flex-wrap px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fecaca', border: '1px solid #ef4444' }} />
          Критический путь
        </span>
        <span className="flex items-center gap-1">
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fed7aa', border: '1px solid #f97316' }} />
          Просрочено
        </span>
        <span className="flex items-center gap-1 ml-auto">FS = finish→start · SS = start→start · FF = finish→finish</span>
      </div>
    </div>
  )
}
