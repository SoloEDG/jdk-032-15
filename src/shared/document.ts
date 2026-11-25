export type PieceKind = 'domino' | 'ramp' | 'splitter' | 'trigger'
export type Axis = 'north' | 'east' | 'south' | 'west'
export type BranchSide = 'left' | 'right'
export type ImpactKind = 'frontal' | 'grazing'

export interface Vec2 { x: number; y: number }

export interface Piece {
  id: string
  kind: PieceKind
  x: number
  y: number
  angle: number
  facing: Axis
  label: string
  height: number
  width: number
  fallThreshold: number
  friction: number
  /**
   * Splitter only. Entry-angle cutoff in degrees [0, 90].
   * An entry angle strictly below the cutoff is a frontal hit;
   * reaching/exceeding it is a grazing hit. Missing => DEFAULT_SPLIT_ANGLE.
   */
  splitAngle?: number
  /** Splitter only. Branch side taken by a frontal hit; grazing takes the opposite side. */
  frontalSide?: BranchSide
}

export interface MechanismConnection {
  id: string
  from: string
  to: string
  delay: number
  enabled: boolean
  /** Optional explicit branch side; when absent the side is derived from target geometry. */
  side?: BranchSide
}

export interface SceneSettings {
  gravity: number
  friction: number
  width: number
  height: number
  showGrid: boolean
}

export interface DominoDocument {
  id: string
  title: string
  revision: number
  updatedAt: number
  pieces: Piece[]
  connections: MechanismConnection[]
  scene: SceneSettings
  startPieceId: string
}

export interface RoutingBasis {
  /** Stable identity of the source↔splitter collision that owns this ruling. */
  collisionId: string
  sourcePieceId: string | null
  /** Deciding entry angle in degrees [0, 90], measured on the first touch. */
  entryAngle: number
  /** Cutoff value snapshotted at propagation time — replay must use this, not current piece props. */
  threshold: number
  impact: ImpactKind
  /** Side actually routed to after applying polarity and the collision latch. */
  routeSide: BranchSide
  frontalSide: BranchSide
  grazingSide: BranchSide
  /** First-touch angle; a rebound second touch may produce a different angle. */
  firstEntryAngle: number
  /** Most recently observed touch angle (may lie on the opposite side of threshold). */
  latestEntryAngle: number
  /** Number of contacts absorbed into this collision (1 unless a rebound/double touch arrived). */
  touchCount: number
  /** True once later touches were ignored for routing to prevent side switching. */
  latched: boolean
  /** Angle of the latest touch was flagged as a rebound/duplicate contact. */
  rebound: boolean
  chosenConnectionId: string | null
  chosenTargetId: string | null
  /** All branch wire ids actually fired by this ruling (usually one). */
  routedConnectionIds: string[]
  /** Label snapshotted at run time so replay never reinterprets via current edits. */
  chosenTargetLabel: string | null
  /** True when enabled wires were found on both geometric sides and one side was selected. */
  twoSided: boolean
  incoming: Vec2
  axis: Vec2
}

export interface SimulationEvent {
  id: string
  pieceId: string
  time: number
  causeId: string | null
  kind: 'trigger' | 'fall' | 'mechanism' | 'interrupted'
  detail: string
  /** Present on splitter events: the immutable routing decision recorded at run time. */
  routing?: RoutingBasis
}

export interface EndpointStatus {
  pieceId: string
  label: string
  kind: PieceKind
  reached: boolean
}

export interface SimulationRun {
  id: string
  documentId: string
  revision: number
  startedAt: number
  startPieceId: string
  status: 'complete' | 'interrupted' | 'empty'
  events: SimulationEvent[]
  interruptedPieceId: string | null
  interruptionReason: string | null
  duration: number
  /** Every trigger in the run-time snapshot with its reachable outcome. */
  endpoints: EndpointStatus[]
  reachedTriggerIds: string[]
}
