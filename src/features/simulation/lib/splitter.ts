import type {
  BranchSide, ImpactKind, MechanismConnection, Piece, RoutingBasis, Vec2,
} from '@/shared/document'

/** Fallback cutoff when a splitter has no persisted splitAngle (old documents). */
export const DEFAULT_SPLIT_ANGLE = 45
/** Default polarity: a frontal hit takes the geometrically left branch. */
export const DEFAULT_FRONTAL_SIDE: BranchSide = 'left'

const MIN_ANGLE = 0
const MAX_ANGLE = 90

export function clampAngle(value: number, min = MIN_ANGLE, max = MAX_ANGLE) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

/**
 * Read the entry-angle cutoff of a splitter.
 * Accepts a few historical/alias field names so documents or fixtures shaped
 * by slightly different iterations keep working.
 */
export function splitThreshold(piece: Piece | undefined | null): number {
  if (!piece) return DEFAULT_SPLIT_ANGLE
  const record = piece as Piece & Record<string, unknown>
  const candidate = piece.splitAngle
    ?? record.angleThreshold
    ?? record.entryAngle
    ?? record.splitThreshold
    ?? record.criticalAngle
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return DEFAULT_SPLIT_ANGLE
  return clampAngle(candidate)
}

export function frontalSideOf(piece: Piece | undefined | null): BranchSide {
  const value = piece?.frontalSide
    ?? ((piece as (Piece & Record<string, unknown>) | null | undefined)?.frontSide)
  return value === 'right' ? 'right' : DEFAULT_FRONTAL_SIDE
}

export function oppositeSide(side: BranchSide): BranchSide {
  return side === 'left' ? 'right' : 'left'
}

export function forwardOf(piece: Pick<Piece, 'angle'>): Vec2 {
  const radians = piece.angle * Math.PI / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

/**
 * Acute entry angle in [0, 90] between the incoming travel direction and the
 * splitter splitting axis. 0° = aligned, head-on / frontal; approaching 90° =
 * nearly parallel to the splitter face, a grazing/edge contact.
 *
 * The axis is unoriented (an incoming hit travels toward the splitter while
 * `forwardOf(splitter)` points out through its outgoing vertex), hence |dot|.
 */
export function entryAngleBetween(incoming: Vec2, axis: Vec2): number {
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(axis.x, axis.y)
  if (denominator === 0) return MAX_ANGLE
  const cosine = Math.abs((incoming.x * axis.x + incoming.y * axis.y) / denominator)
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
}

/**
 * Cutoff classification. An angle strictly below the threshold is frontal;
 * reaching or exceeding the threshold is grazing.
 */
export function classifyImpact(entryAngle: number, threshold: number): ImpactKind {
  return entryAngle < threshold ? 'frontal' : 'grazing'
}

export function sideForImpact(impact: ImpactKind, frontalSide: BranchSide): BranchSide {
  return impact === 'frontal' ? frontalSide : oppositeSide(frontalSide)
}

/**
 * Geometric side of `delta` relative to an axis.
 * The canvas uses y-down coordinates: facing east (axis = +x), a target above
 * the splitter has delta.y < 0 and cross(axis, delta) < 0, which is the
 * visually LEFT branch. Collinear deltas return null.
 */
export function sideOfDelta(axis: Vec2, delta: Vec2): BranchSide | null {
  const cross = axis.x * delta.y - axis.y * delta.x
  if (Math.abs(cross) < 1e-7) return null
  return cross < 0 ? 'left' : 'right'
}

export function sideOfTarget(source: Piece, target: Piece | undefined): BranchSide | null {
  if (!target) return null
  const axis = forwardOf(source)
  return sideOfDelta(axis, { x: target.x - source.x, y: target.y - source.y })
}

/** Resolve a connection branch side: explicit `side`/`branch` wins, otherwise geometry. */
export function resolveConnectionSide(
  link: MechanismConnection,
  source: Piece,
  target: Piece | undefined,
): BranchSide | null {
  const aliased = link as MechanismConnection & { branch?: unknown }
  const explicit = link.side
    ?? (aliased.branch === 'left' || aliased.branch === 'right' ? aliased.branch : null)
  if (explicit === 'left' || explicit === 'right') return explicit
  return sideOfTarget(source, target)
}

export interface BranchSelection {
  /** Enabled links that should propagate under the current ruling. */
  links: MechanismConnection[]
  /** Enabled links classified onto the ruled side (empty in legacy fan-out mode). */
  ruledLinks: MechanismConnection[]
  twoSided: boolean
  sides: { linkId: string; side: BranchSide | null }[]
}

/**
 * Choose which pre-connected branch links fire.
 *
 * When enabled wires are present on BOTH sides of the splitter, this is a
 * genuine angle-routed fork and only the ruled side fires. Sides come from an
 * explicit `side` field first, then target geometry. For exactly two wires
 * with degenerate geometry, the missing side is inferred (opposite of the
 * known side, otherwise wiring order: first = left, second = right).
 * One-sided / 3+ wire setups keep legacy fan-out semantics.
 */
export function selectBranchConnections(
  source: Piece,
  connections: readonly MechanismConnection[],
  pieces: readonly Piece[],
  routeSide: BranchSide,
): BranchSelection {
  const enabled = connections.filter(link => link.from === source.id && link.enabled)
  const resolved = enabled.map(link =>
    resolveConnectionSide(link, source, pieces.find(piece => piece.id === link.to)))

  let sides: (BranchSide | null)[] = resolved
  if (sides.some(side => side === null) && enabled.length === 2) {
    const known = sides.find((side): side is BranchSide => side !== null) ?? null
    sides = sides.map((side, index) => {
      if (side) return side
      if (known) return oppositeSide(known)
      return index === 0 ? 'left' : 'right'
    })
  }

  const annotated = enabled.map((link, index) => ({ link, side: sides[index] }))
  const presentSides = new Set(sides.filter((side): side is BranchSide => side !== null))
  const twoSided = presentSides.has('left') && presentSides.has('right')

  if (!twoSided) {
    return {
      links: [...enabled], ruledLinks: [], twoSided: false,
      sides: enabled.map((link, index) => ({ linkId: link.id, side: sides[index] ?? null })),
    }
  }
  const ruledLinks = annotated.filter(entry => entry.side === routeSide).map(entry => entry.link)
  return {
    links: ruledLinks, ruledLinks, twoSided: true,
    sides: annotated.map(entry => ({ linkId: entry.link.id, side: entry.side })),
  }
}

export interface TouchInput {
  time?: number
  /** Incoming travel direction for this touch. */
  direction?: Vec2
  /** Explicit entry angle in degrees; takes precedence over `direction`. */
  entryAngle?: number
  /** Marks a rebound / repeated contact within the same collision. */
  rebound?: boolean
}

export interface TouchRecord {
  sequence: number
  time: number
  entryAngle: number
  impact: ImpactKind
  rebound: boolean
  incoming: Vec2 | null
}

export interface RouteDecision {
  collisionId: string
  splitterId: string
  threshold: number
  frontalSide: BranchSide
  /** The first touch — its angle/classification permanently own the route. */
  first: TouchRecord
  /** The most recently absorbed touch (may be a rebound past the threshold). */
  latest: TouchRecord
  touchCount: number
  /** True once extra touches arrived and were denied a route switch. */
  latched: boolean
  impact: ImpactKind
  entryAngle: number
  routeSide: BranchSide
}

/**
 * A stateful, single-collision routing gate.
 *
 * The first touch establishes ("latches") the route. Every later touch caused
 * by a glancing rebound or a consecutive double contact is recorded for
 * audit but can never flip `routeSide` — this is the no-toggle guarantee.
 */
export class CollisionGate {
  readonly records: TouchRecord[] = []
  decision: RouteDecision | null = null

  constructor(
    readonly collisionId: string,
    readonly splitterId: string,
    readonly threshold: number,
    readonly frontalSide: BranchSide = DEFAULT_FRONTAL_SIDE,
    readonly axis: Vec2 = { x: 1, y: 0 },
  ) {}

  touch(input: TouchInput): RouteDecision {
    const sequence = this.records.length + 1
    let angle: number
    let incoming: Vec2 | null
    if (typeof input.entryAngle === 'number' && Number.isFinite(input.entryAngle)) {
      angle = clampAngle(input.entryAngle)
      incoming = input.direction ? { ...input.direction } : null
    } else if (input.direction) {
      angle = entryAngleBetween(input.direction, this.axis)
      incoming = { ...input.direction }
    } else {
      angle = 0
      incoming = null
    }
    const record: TouchRecord = {
      sequence,
      time: input.time ?? sequence * 0.05,
      entryAngle: angle,
      impact: classifyImpact(angle, this.threshold),
      rebound: input.rebound ?? sequence > 1,
      incoming,
    }
    this.records.push(record)

    if (!this.decision) {
      const impact = record.impact
      this.decision = {
        collisionId: this.collisionId,
        splitterId: this.splitterId,
        threshold: this.threshold,
        frontalSide: this.frontalSide,
        first: record,
        latest: record,
        touchCount: 1,
        latched: false,
        impact,
        entryAngle: record.entryAngle,
        routeSide: sideForImpact(impact, this.frontalSide),
      }
    } else {
      // Absorb the extra touch; every routing field stays derived from `first`.
      this.decision.latest = record
      this.decision.touchCount = this.records.length
      this.decision.latched = this.records.length > 1
    }
    return this.decision
  }
}

/** Keeps one gate per collision id for the duration of a propagation run. */
export class SplitterRouter {
  private readonly gates = new Map<string, CollisionGate>()

  gate(
    collisionId: string,
    init: { splitterId: string; threshold: number; frontalSide?: BranchSide; axis?: Vec2 },
  ): CollisionGate {
    let gate = this.gates.get(collisionId)
    if (!gate) {
      gate = new CollisionGate(
        collisionId,
        init.splitterId,
        init.threshold,
        init.frontalSide ?? DEFAULT_FRONTAL_SIDE,
        init.axis ?? { x: 1, y: 0 },
      )
      this.gates.set(collisionId, gate)
    }
    return gate
  }

  existing(collisionId: string): CollisionGate | null {
    return this.gates.get(collisionId) ?? null
  }
}

/**
 * Verification helper: feed a whole contact sequence (first hit plus possible
 * rebound/double touches) through one collision gate and return the stable
 * decision.
 */
export function evaluateTouchSequence(
  init: {
    collisionId?: string
    splitterId?: string
    threshold?: number
    frontalSide?: BranchSide
    axis?: Vec2
  },
  touches: readonly TouchInput[],
): RouteDecision {
  const gate = new CollisionGate(
    init.collisionId ?? 'collision-1',
    init.splitterId ?? 'splitter-1',
    init.threshold ?? DEFAULT_SPLIT_ANGLE,
    init.frontalSide ?? DEFAULT_FRONTAL_SIDE,
    init.axis ?? { x: 1, y: 0 },
  )
  for (const touch of touches) gate.touch(touch)
  if (!gate.decision) gate.touch({})
  return gate.decision!
}

const SIDE_LABEL: Record<BranchSide, string> = { left: '左', right: '右' }

export function sideLabel(side: BranchSide): string {
  return SIDE_LABEL[side]
}

export const IMPACT_LABEL: Record<ImpactKind, string> = {
  frontal: '正面撞击',
  grazing: '擦边撞击',
}

/** Human-readable, snapshot-safe explanation of a routing basis. */
export function describeRouting(basis: Pick<
  RoutingBasis,
  'entryAngle' | 'threshold' | 'impact' | 'routeSide' | 'touchCount' | 'latched' | 'latestEntryAngle'
>): string {
  const comparison = basis.entryAngle < basis.threshold ? '<' : '≥'
  const latchNote = basis.latched
    ? `；后续触碰 ${basis.latestEntryAngle.toFixed(1)}° 未改向（同碰撞 ${basis.touchCount} 次触碰）`
    : ''
  return `入射角 ${basis.entryAngle.toFixed(1)}° ${comparison} 分界 ${basis.threshold.toFixed(0)}°，`
    + `${IMPACT_LABEL[basis.impact]} → ${sideLabel(basis.routeSide)}支路${latchNote}`
}

/** Convert a gate decision plus chosen wire into the event-persisted basis. */
export function toRoutingBasis(
  decision: RouteDecision,
  extra: {
    sourcePieceId: string | null
    chosenConnectionId: string | null
    chosenTargetId: string | null
    routedConnectionIds: string[]
    chosenTargetLabel: string | null
    twoSided: boolean
    incoming: Vec2
    axis: Vec2
  },
): RoutingBasis {
  return {
    collisionId: decision.collisionId,
    sourcePieceId: extra.sourcePieceId,
    entryAngle: decision.entryAngle,
    threshold: decision.threshold,
    impact: decision.impact,
    routeSide: decision.routeSide,
    frontalSide: decision.frontalSide,
    grazingSide: oppositeSide(decision.frontalSide),
    firstEntryAngle: decision.first.entryAngle,
    latestEntryAngle: decision.latest.entryAngle,
    touchCount: decision.touchCount,
    latched: decision.latched,
    rebound: decision.latest.rebound,
    chosenConnectionId: extra.chosenConnectionId,
    chosenTargetId: extra.chosenTargetId,
    routedConnectionIds: extra.routedConnectionIds,
    chosenTargetLabel: extra.chosenTargetLabel,
    twoSided: extra.twoSided,
    incoming: extra.incoming,
    axis: extra.axis,
  }
}
