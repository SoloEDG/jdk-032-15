import { describe, expect, it } from 'vitest'
import type { DominoDocument, MechanismConnection, Piece } from '@/shared/document'
import { propagate } from './propagate'
import { createDefaultDocument } from '@/shared/defaults'

function piece(partial: Partial<Piece> & Pick<Piece, 'id' | 'kind'>): Piece {
  return {
    x: 0, y: 0, angle: 0, facing: 'east', label: partial.id,
    height: 1.6, width: 0.42, fallThreshold: 0.8, friction: 0.55,
    ...partial,
  }
}

function makeDoc(pieces: Piece[], connections: MechanismConnection[], startPieceId = 'src'): DominoDocument {
  return {
    id: 'fork-doc', title: 'angle fork', revision: 1, updatedAt: 0,
    pieces, connections, startPieceId,
    scene: { gravity: 9.8, friction: 0.62, width: 20, height: 10, showGrid: false },
  }
}

/**
 * Minimal angle-fork scene.
 * src (angle = approach angle) sits directly left of sp (axis east).
 * tL is upper-right (geometric left branch), tR lower-right (right branch).
 */
function forkDocument(approachAngle: number, extra?: { wireIntoSplitter?: boolean; threshold?: number }) {
  const src = piece({ id: 'src', kind: 'domino', x: 4.6, y: 3, angle: approachAngle })
  const sp = piece({
    id: 'sp', kind: 'splitter', x: 6, y: 3, width: 0.75,
    splitAngle: extra?.threshold ?? 45, frontalSide: 'left',
  })
  const tL = piece({ id: 'tL', kind: 'trigger', x: 8.4, y: 1.7, height: 0.8 })
  const tR = piece({ id: 'tR', kind: 'trigger', x: 8.4, y: 4.3, height: 0.8 })
  const connections: MechanismConnection[] = [
    { id: 'cL', from: 'sp', to: 'tL', delay: 0.01, enabled: true },
    { id: 'cR', from: 'sp', to: 'tR', delay: 0.01, enabled: true },
  ]
  if (extra?.wireIntoSplitter) {
    connections.push({ id: 'c0', from: 'src', to: 'sp', delay: 0.1, enabled: true })
  }
  return makeDoc([src, sp, tL, tR], connections)
}

function splitterRouting(run: ReturnType<typeof propagate>) {
  const event = run.events.find(item => item.pieceId === 'sp' && item.routing)
  if (!event?.routing) throw new Error('expected splitter routing basis on event')
  return event.routing
}

describe('propagate · angle threshold drives the branch', () => {
  it('approximate angles on both sides of 45° reach different endpoints', () => {
    const justBelow = propagate(forkDocument(44.6))
    const justAbove = propagate(forkDocument(45.4))

    const belowBasis = splitterRouting(justBelow)
    const aboveBasis = splitterRouting(justAbove)

    expect(belowBasis.entryAngle).toBeCloseTo(44.6, 5)
    expect(belowBasis.impact).toBe('frontal')
    expect(belowBasis.routeSide).toBe('left')
    expect(justBelow.reachedTriggerIds).toEqual(['tL'])
    expect(justBelow.endpoints.find(e => e.pieceId === 'tL')?.reached).toBe(true)
    expect(justBelow.endpoints.find(e => e.pieceId === 'tR')?.reached).toBe(false)

    expect(aboveBasis.entryAngle).toBeCloseTo(45.4, 5)
    expect(aboveBasis.impact).toBe('grazing')
    expect(aboveBasis.routeSide).toBe('right')
    expect(justAbove.reachedTriggerIds).toEqual(['tR'])
    expect(justAbove.endpoints.find(e => e.pieceId === 'tR')?.reached).toBe(true)
    expect(justAbove.endpoints.find(e => e.pieceId === 'tL')?.reached).toBe(false)

    expect(justBelow.status).toBe('complete')
    expect(justAbove.status).toBe('complete')
  })

  it('adjusting only the threshold flips the near-critical route and endpoint state', () => {
    const approachAngle = 45
    const wide = propagate(forkDocument(approachAngle, { threshold: 46 }))
    const tight = propagate(forkDocument(approachAngle, { threshold: 44 }))

    expect(splitterRouting(wide).impact).toBe('frontal')
    expect(wide.reachedTriggerIds).toEqual(['tL'])
    expect(splitterRouting(tight).impact).toBe('grazing')
    expect(tight.reachedTriggerIds).toEqual(['tR'])
  })
})

describe('propagate · two consecutive touches in one collision', () => {
  it('absorbs the geometric + wired double contact without toggling or double routing', () => {
    const run = propagate(forkDocument(20, { wireIntoSplitter: true }))
    const basis = splitterRouting(run)

    expect(basis.collisionId).toBe('src->sp')
    expect(basis.touchCount).toBe(2)
    expect(basis.latched).toBe(true)
    expect(basis.routeSide).toBe('left')
    // Exactly one branch endpoint is reachable.
    expect(run.reachedTriggerIds).toEqual(['tL'])
    // Only one mechanism event for the splitter itself.
    expect(run.events.filter(e => e.pieceId === 'sp')).toHaveLength(1)
  })
})

describe('propagate · threshold edits never rewrite recorded events', () => {
  it('keeps the fallen branch basis, while a new run uses the new threshold', () => {
    const document = forkDocument(40, { threshold: 45 })
    const recorded = propagate(document)
    const recordedBasis = splitterRouting(recorded)
    expect(recordedBasis.routeSide).toBe('left')
    expect(recordedBasis.threshold).toBe(45)
    expect(recorded.reachedTriggerIds).toEqual(['tL'])

    // User adjusts the threshold after the run (revision bump happens in the app).
    const adjusted: DominoDocument = {
      ...document,
      revision: document.revision + 1,
      pieces: document.pieces.map(p => p.id === 'sp' ? { ...p, splitAngle: 20 } : p),
    }

    // The archived run — what the replay renders — is unchanged.
    const stillRecorded = splitterRouting(recorded)
    expect(stillRecorded.threshold).toBe(45)
    expect(stillRecorded.routeSide).toBe('left')
    expect(stillRecorded.chosenTargetId).toBe('tL')

    // A subsequent propagation (an untriggered fork in the new pass) uses it.
    const rerun = propagate(adjusted)
    const rerunBasis = splitterRouting(rerun)
    expect(rerunBasis.threshold).toBe(20)
    expect(rerunBasis.impact).toBe('grazing') // 40° >= 20°
    expect(rerunBasis.routeSide).toBe('right')
    expect(rerun.reachedTriggerIds).toEqual(['tR'])
  })
})

describe('propagate · default starter scene', () => {
  it('routes the built-in fork to endpoint A and completes', () => {
    const run = propagate(createDefaultDocument())
    const s1 = run.events.find(e => e.pieceId === 's1' && e.routing)
    expect(s1?.routing).toBeDefined()
    expect(s1!.routing!.entryAngle).toBeCloseTo(40, 5)
    expect(s1!.routing!.impact).toBe('frontal')
    expect(s1!.routing!.routeSide).toBe('left')
    expect(run.reachedTriggerIds).toContain('t1')
    expect(run.status).toBe('complete')
    expect(run.endpoints).toEqual([
      expect.objectContaining({ pieceId: 't1', reached: true }),
    ])
  })
})
