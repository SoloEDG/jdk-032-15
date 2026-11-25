import type { DominoDocument, Piece, SimulationEvent, Vec2 } from '@/shared/document'
import { nextContact } from '@/features/layout/lib/geometry'
import {
  describeRouting,
  forwardOf,
  frontalSideOf,
  selectBranchConnections,
  splitThreshold,
  SplitterRouter,
  toRoutingBasis,
} from './splitter'

interface Scheduled {
  pieceId: string
  time: number
  causeId: string | null
  detail: string
  /** Piece whose fall/contact created this queue entry (the striker). */
  sourcePieceId?: string | null
  /** Stable source↔target collision identity, used by the splitter latch. */
  collisionId?: string
  /** Incoming travel direction for a contact touch. */
  incoming?: Vec2
  /** Explicit touch angle override (degrees). */
  entryAngle?: number
  /** Marks a rebound / repeated touch inside one collision. */
  rebound?: boolean
}

export function propagate(document: DominoDocument) {
  const queue: Scheduled[] = [{ pieceId: document.startPieceId, time: 0, causeId: null, detail: '手动触发' }]
  const fallen = new Set<string>()
  const events: SimulationEvent[] = []
  const reachedTriggerIds = new Set<string>()
  const router = new SplitterRouter()
  const splitterEvents = new Map<string, SimulationEvent>()
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null

  function contactKey(sourceId: string, targetId: string) {
    return `${sourceId}->${targetId}`
  }

  /**
   * A second queue entry for an already-fallen splitter can represent a
   * glancing rebound or a consecutive touch from the same collision. Feed it
   * to the existing latch so it is recorded but cannot change the route.
   */
  function absorbRepeatedTouch(next: Scheduled, piece: Piece) {
    if (piece.kind !== 'splitter' || !next.collisionId) return
    const gate = router.existing(next.collisionId)
    if (!gate?.decision) return
    const decision = gate.touch({
      direction: next.incoming,
      entryAngle: next.entryAngle,
      time: next.time,
      rebound: next.rebound ?? true,
    })
    const persisted = splitterEvents.get(piece.id)
    if (persisted?.routing) {
      persisted.routing.touchCount = decision.touchCount
      persisted.routing.latched = decision.latched
      persisted.routing.latestEntryAngle = decision.latest.entryAngle
      persisted.routing.rebound = decision.latest.rebound
    }
  }

  while (queue.length && events.length < document.pieces.length * 3) {
    queue.sort((a, b) => a.time - b.time || a.pieceId.localeCompare(b.pieceId) || (a.causeId ?? '').localeCompare(b.causeId ?? ''))
    const next = queue.shift()!
    const piece = document.pieces.find(item => item.id === next.pieceId)
    if (!piece) continue
    if (fallen.has(piece.id)) {
      absorbRepeatedTouch(next, piece)
      continue
    }

    if (piece.kind === 'trigger') {
      reachedTriggerIds.add(piece.id)
      const event: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
        causeId: next.causeId, kind: 'mechanism', detail: `触发器响应 · ${next.detail}`,
      }
      events.push(event)
      for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
        queue.push({
          pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线',
          sourcePieceId: piece.id, collisionId: contactKey(piece.id, link.to), incoming: forwardOf(piece),
        })
      }
      continue
    }

    if (piece.kind === 'splitter') {
      const threshold = splitThreshold(piece)
      const frontalSide = frontalSideOf(piece)
      const axis = forwardOf(piece)
      const sourcePiece = next.sourcePieceId
        ? document.pieces.find(item => item.id === next.sourcePieceId) ?? null
        : null
      const incoming: Vec2 = next.incoming
        ?? (sourcePiece ? forwardOf(sourcePiece) : axis)
      const collisionId = next.collisionId ?? `spontaneous:${piece.id}@${next.time}`

      // First touch of this collision permanently owns the routing decision.
      const gate = router.gate(collisionId, { splitterId: piece.id, threshold, frontalSide, axis })
      const decision = gate.touch({
        direction: incoming, entryAngle: next.entryAngle, time: next.time, rebound: next.rebound ?? false,
      })

      const selection = selectBranchConnections(piece, document.connections, document.pieces, decision.routeSide)
      const chosenLink = selection.twoSided ? selection.ruledLinks[0] ?? null : null
      const chosenTarget = chosenLink
        ? document.pieces.find(item => item.id === chosenLink.to) ?? null
        : null
      const routing = toRoutingBasis(decision, {
        sourcePieceId: sourcePiece?.id ?? next.sourcePieceId ?? null,
        chosenConnectionId: chosenLink?.id ?? null,
        chosenTargetId: chosenLink?.to ?? null,
        routedConnectionIds: selection.links.map(link => link.id),
        chosenTargetLabel: chosenTarget?.label ?? chosenLink?.to ?? null,
        twoSided: selection.twoSided,
        incoming,
        axis,
      })

      fallen.add(piece.id)
      const event: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
        causeId: next.causeId, kind: 'mechanism',
        detail: `分岔展开 · ${describeRouting(routing)}`,
        routing,
      }
      events.push(event)
      splitterEvents.set(piece.id, event)

      if (selection.twoSided) {
        // Genuine left/right fork: only the ruled branch side continues.
        for (const link of selection.links) {
          queue.push({
            pieceId: link.to, time: next.time + link.delay, causeId: event.id,
            detail: `${decision.routeSide === 'left' ? '左' : '右'}支路连线`,
            sourcePieceId: piece.id, collisionId: contactKey(piece.id, link.to), incoming: forwardOf(piece),
          })
        }
      } else {
        // One-sided / unclassified wiring: preserve legacy connection fan-out.
        for (const link of selection.links) {
          queue.push({
            pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线',
            sourcePieceId: piece.id, collisionId: contactKey(piece.id, link.to), incoming: forwardOf(piece),
          })
        }
      }

      // Geometric fallback only when wiring is not an explicit two-sided fork;
      // otherwise the chosen pre-connected branch is authoritative.
      let target: Piece | null = null
      if (!selection.twoSided) {
        const available = document.pieces.filter(item => !fallen.has(item.id) && item.id !== piece.id)
        const surfaceGrip = (document.scene.friction + piece.friction) / 2
        const reachScale = (0.94 + surfaceGrip * 0.35) * (1.25 - piece.fallThreshold * 0.25)
        target = nextContact(piece, available, reachScale)
        if (target) {
          const separation = Math.hypot(piece.x - target.x, piece.y - target.y)
          const speed = Math.max(1.8, piece.height * document.scene.gravity / 2) * (0.75 + surfaceGrip * 0.5)
          const travel = Math.max(0.24, separation / speed)
          queue.push({
            pieceId: target.id, time: next.time + travel, causeId: event.id,
            detail: '分岔臂接触',
            sourcePieceId: piece.id, collisionId: contactKey(piece.id, target.id), incoming: forwardOf(piece),
          })
        }
      }

      const hasConnection = document.connections.some(link => link.from === piece.id && link.enabled)
      if (!target && !hasConnection && interruptedPieceId === null) {
        interruptedPieceId = piece.id
        interruptionReason = '倒下方向内没有可触达的元件，链路在此停止。'
        events.push({
          id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time + 0.05,
          causeId: event.id, kind: 'interrupted', detail: interruptionReason,
        })
      }
      continue
    }

    fallen.add(piece.id)
    const event: SimulationEvent = {
      id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
      causeId: next.causeId, kind: 'fall',
      detail: piece.kind === 'ramp' ? `坡道传递 · ${next.detail}` : `受力倒下 · ${next.detail}`,
    }
    events.push(event)

    for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
      queue.push({
        pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线',
        sourcePieceId: piece.id, collisionId: contactKey(piece.id, link.to), incoming: forwardOf(piece),
      })
    }

    const available = document.pieces.filter(item => !fallen.has(item.id) && item.id !== piece.id)
    const surfaceGrip = (document.scene.friction + piece.friction) / 2
    const reachScale = (0.94 + surfaceGrip * 0.35) * (1.25 - piece.fallThreshold * 0.25)
    let target: Piece | null = null
    if (piece.kind === 'ramp') {
      target = available.filter(item => item.x > piece.x && Math.abs(item.y - piece.y) < 2.1)
        .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))[0] ?? null
    } else {
      target = nextContact(piece, available, reachScale)
    }
    if (target) {
      const separation = Math.hypot(piece.x - target.x, piece.y - target.y)
      const speed = Math.max(1.8, piece.height * document.scene.gravity / 2) * (0.75 + surfaceGrip * 0.5)
      const travel = Math.max(0.24, separation / speed)
      queue.push({
        pieceId: target.id, time: next.time + travel, causeId: event.id,
        detail: piece.kind === 'ramp' ? '坡面末端接触' : '相邻接触',
        sourcePieceId: piece.id, collisionId: contactKey(piece.id, target.id), incoming: forwardOf(piece),
      })
    }

    const hasConnection = document.connections.some(link => link.from === piece.id && link.enabled)
    if (!target && !hasConnection && interruptedPieceId === null) {
      interruptedPieceId = piece.id
      interruptionReason = '倒下方向内没有可触达的元件，链路在此停止。'
      events.push({
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time + 0.05,
        causeId: event.id, kind: 'interrupted', detail: interruptionReason,
      })
    }
  }

  const endpoints = document.pieces
    .filter(piece => piece.kind === 'trigger')
    .map(piece => ({
      pieceId: piece.id,
      label: piece.label,
      kind: piece.kind,
      reached: reachedTriggerIds.has(piece.id),
    }))

  return {
    events,
    endpoints,
    reachedTriggerIds: [...reachedTriggerIds],
    interruptedPieceId,
    interruptionReason,
    reachedTrigger: reachedTriggerIds.size > 0,
    status: events.length === 0 ? 'empty' as const
      : interruptedPieceId || reachedTriggerIds.size === 0 ? 'interrupted' as const : 'complete' as const,
    duration: events.at(-1)?.time ?? 0,
  }
}
