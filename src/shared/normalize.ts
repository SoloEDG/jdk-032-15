import type { DominoDocument } from './document'

const FALLBACK_SPLIT_ANGLE = 45
const FALLBACK_FRONTAL_SIDE = 'left' as const

/**
 * Fill fields introduced after older documents were saved so controls never
 * read `undefined`. Routing decisions of stored runs stay untouched.
 */
export function normalizeDocument(input: DominoDocument): DominoDocument {
  return {
    ...input,
    pieces: input.pieces.map(piece => piece.kind === 'splitter'
      ? {
        ...piece,
        splitAngle: typeof piece.splitAngle === 'number' && Number.isFinite(piece.splitAngle)
          ? piece.splitAngle
          : FALLBACK_SPLIT_ANGLE,
        frontalSide: piece.frontalSide === 'right' ? 'right' as const : FALLBACK_FRONTAL_SIDE,
      }
      : piece),
  }
}
