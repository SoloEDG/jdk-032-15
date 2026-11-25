import { describe, expect, it } from 'vitest'
import type { Piece } from '@/shared/document'
import {
  classifyImpact,
  entryAngleBetween,
  evaluateTouchSequence,
  oppositeSide,
  selectBranchConnections,
  sideForImpact,
  sideOfDelta,
  SplitterRouter,
} from './splitter'

const axisEast = { x: 1, y: 0 }
/** Direction vector at `degrees` measured in the canvas coordinate convention. */
function dir(degrees: number) {
  const rad = degrees * Math.PI / 180
  return { x: Math.cos(rad), y: Math.sin(rad) }
}

describe('entry angle geometry', () => {
  it('reads 0° for a head-on pass along the splitter axis', () => {
    expect(entryAngleBetween(dir(0), axisEast)).toBeCloseTo(0, 6)
    // Unoriented axis: travelling opposite the outgoing normal is still head-on.
    expect(entryAngleBetween(dir(180), axisEast)).toBeCloseTo(0, 6)
  })

  it('reads ~90° for a perpendicular grazing pass', () => {
    expect(entryAngleBetween(dir(90), axisEast)).toBeCloseTo(90, 6)
    expect(entryAngleBetween(dir(-90), axisEast)).toBeCloseTo(90, 6)
  })

  it('matches known oblique approach angles', () => {
    expect(entryAngleBetween(dir(30), axisEast)).toBeCloseTo(30, 5)
    expect(entryAngleBetween(dir(-42), axisEast)).toBeCloseTo(42, 5)
    expect(entryAngleBetween(dir(60), axisEast)).toBeCloseTo(60, 5)
  })
})

describe('threshold classification — approximate angles on both sides', () => {
  const threshold = 45

  it('treats angles just below the cutoff as frontal', () => {
    for (const angle of [44.9, 44.6, 44.1, 40]) {
      expect(classifyImpact(angle, threshold)).toBe('frontal')
    }
  })

  it('treats angles just above the cutoff as grazing', () => {
    for (const angle of [45.1, 45.4, 45.9, 50]) {
      expect(classifyImpact(angle, threshold)).toBe('grazing')
    }
  })

  it('routes the tight threshold pair to opposite branches (default polarity)', () => {
    const below = evaluateTouchSequence(
      { threshold, frontalSide: 'left', axis: axisEast },
      [{ entryAngle: 44.6 }],
    )
    const above = evaluateTouchSequence(
      { threshold, frontalSide: 'left', axis: axisEast },
      [{ entryAngle: 45.4 }],
    )
    expect(below.impact).toBe('frontal')
    expect(below.routeSide).toBe('left')
    expect(above.impact).toBe('grazing')
    expect(above.routeSide).toBe('right')
    expect(below.routeSide).not.toBe(above.routeSide)
  })

  it('flips both sides when frontal polarity is swapped', () => {
    expect(sideForImpact('frontal', 'right')).toBe('right')
    expect(sideForImpact('grazing', 'right')).toBe('left')
    expect(oppositeSide('left')).toBe('right')
  })
})

describe('collision latch — two consecutive touches', () => {
  it('keeps one stable ruling for two equal consecutive touches', () => {
    const decision = evaluateTouchSequence(
      { threshold: 45, frontalSide: 'left', axis: axisEast },
      [{ entryAngle: 40, time: 0.1 }, { entryAngle: 40, time: 0.26, rebound: true }],
    )
    expect(decision.touchCount).toBe(2)
    expect(decision.latched).toBe(true)
    expect(decision.routeSide).toBe('left')
    expect(decision.impact).toBe('frontal')
  })

  it('an untouched gate reports a single deciding touch', () => {
    const decision = evaluateTouchSequence(
      { threshold: 45 },
      [{ entryAngle: 60 }],
    )
    expect(decision.touchCount).toBe(1)
    expect(decision.latched).toBe(false)
  })
})

describe('collision latch — grazing rebound', () => {
  it('does not switch sides when a grazing first hit rebounds into a frontal-angle second touch', () => {
    // First contact 52° >= 45 => grazing => right (default polarity).
    // Rebound comes back at 31° < 45, which alone would be frontal => left.
    const decision = evaluateTouchSequence(
      { collisionId: 'd6->s1', threshold: 45, frontalSide: 'left', axis: dir(20) },
      [
        { entryAngle: 52, time: 1.2 },
        { entryAngle: 31, time: 1.41, rebound: true },
      ],
    )
    expect(decision.first.entryAngle).toBe(52)
    expect(decision.first.impact).toBe('grazing')
    expect(decision.routeSide).toBe('right')
    expect(decision.latest.entryAngle).toBe(31)
    expect(decision.latest.impact).toBe('frontal')
    expect(decision.touchCount).toBe(2)
    expect(decision.latched).toBe(true)
    // The defining guarantee: latest classification differs, route does not.
    expect(decision.impact).toBe('grazing')
    expect(decision.routeSide).toBe('right')
  })

  it('also holds a frontal first route against a later grazing rebound', () => {
    const decision = evaluateTouchSequence(
      { threshold: 45, frontalSide: 'left' },
      [{ entryAngle: 28 }, { entryAngle: 63, rebound: true }],
    )
    expect(decision.routeSide).toBe('left')
    expect(decision.impact).toBe('frontal')
    expect(decision.latest.impact).toBe('grazing')
  })

  it('never toggles across many alternating rebound touches', () => {
    const router = new SplitterRouter()
    const gate = router.gate('c1', { splitterId: 's1', threshold: 45, frontalSide: 'left', axis: axisEast })
    const angles = [50, 30, 55, 20, 60, 35]
    for (const [index, angle] of angles.entries()) {
      const result = gate.touch({ entryAngle: angle, rebound: index > 0 })
      expect(result.routeSide).toBe('right') // first angle 50° latched grazing/right
    }
    expect(gate.decision?.touchCount).toBe(6)
    expect(gate.decision?.latched).toBe(true)
  })

  it('isolates latch state by collision id', () => {
    const router = new SplitterRouter()
    const a = router.gate('srcA->s1', { splitterId: 's1', threshold: 45 })
    const b = router.gate('srcB->s1', { splitterId: 's1', threshold: 45 })
    a.touch({ entryAngle: 60 })
    b.touch({ entryAngle: 20 })
    expect(a.decision?.routeSide).toBe('right')
    expect(b.decision?.routeSide).toBe('left')
  })
})

describe('geometric branch sides', () => {
  const source = { id: 's', x: 6, y: 3, angle: 0 } as Piece
  const leftTarget = { id: 'l', x: 8, y: 1.8 } as Piece
  const rightTarget = { id: 'r', x: 8, y: 4.2 } as Piece

  it('labels upper delta as left and lower delta as right on the y-down canvas', () => {
    expect(sideOfDelta(axisEast, { x: 2, y: -1.2 })).toBe('left')
    expect(sideOfDelta(axisEast, { x: 2, y: 1.2 })).toBe('right')
  })

  it('selects only the ruled wire for a two-sided fork', () => {
    const connections = [
      { id: 'cL', from: 's', to: 'l', delay: 0.1, enabled: true },
      { id: 'cR', from: 's', to: 'r', delay: 0.1, enabled: true },
    ]
    const left = selectBranchConnections(source, connections, [source, leftTarget, rightTarget], 'left')
    expect(left.twoSided).toBe(true)
    expect(left.links.map(link => link.id)).toEqual(['cL'])
    const right = selectBranchConnections(source, connections, [source, leftTarget, rightTarget], 'right')
    expect(right.links.map(link => link.id)).toEqual(['cR'])
  })

  it('preserves fan-out for one-sided legacy wiring', () => {
    const connections = [
      { id: 'c1', from: 's', to: 'l', delay: 0.1, enabled: true },
    ]
    const selection = selectBranchConnections(source, connections, [source, leftTarget], 'right')
    expect(selection.twoSided).toBe(false)
    expect(selection.links.map(link => link.id)).toEqual(['c1'])
  })

  it('honours explicit connection.side overrides', () => {
    const connections = [
      { id: 'c1', from: 's', to: 'l', delay: 0.1, enabled: true, side: 'right' as const },
      { id: 'c2', from: 's', to: 'r', delay: 0.1, enabled: true, side: 'left' as const },
    ]
    const selection = selectBranchConnections(source, connections, [source, leftTarget, rightTarget], 'left')
    expect(selection.links.map(link => link.id)).toEqual(['c2'])
  })

  it('turns exactly two collinear wires into an order-based fork', () => {
    const collinearA = { id: 'a', x: 8, y: 3 } as Piece
    const collinearB = { id: 'b', x: 9.5, y: 3 } as Piece
    const connections = [
      { id: 'first', from: 's', to: 'a', delay: 0.1, enabled: true },
      { id: 'second', from: 's', to: 'b', delay: 0.1, enabled: true },
    ]
    const pieces = [{ ...source, x: 6, y: 3 }, collinearA, collinearB]
    const left = selectBranchConnections(pieces[0], connections, pieces, 'left')
    expect(left.twoSided).toBe(true)
    expect(left.links.map(link => link.id)).toEqual(['first'])
    const right = selectBranchConnections(pieces[0], connections, pieces, 'right')
    expect(right.links.map(link => link.id)).toEqual(['second'])
  })
})
