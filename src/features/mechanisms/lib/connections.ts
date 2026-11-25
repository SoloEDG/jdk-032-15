import type { BranchSide, DominoDocument, MechanismConnection } from '@/shared/document'
import { stableId } from '@/shared/time'
import { forwardVector } from '@/features/layout/lib/geometry'

export function availableTargets(document: DominoDocument, from: string) {
  const used = new Set(document.connections.filter(link => link.from === from).map(link => link.to))
  return document.pieces.filter(piece => piece.id !== from && !used.has(piece.id))
}

/**
 * Resolve whether a splitter wire serves the geometrically left or right
 * branch relative to the splitter facing angle. Explicit `link.side` wins.
 */
export function connectionBranchSide(
  document: DominoDocument,
  link: MechanismConnection,
): BranchSide | null {
  if (link.side === 'left' || link.side === 'right') return link.side
  const source = document.pieces.find(piece => piece.id === link.from)
  const target = document.pieces.find(piece => piece.id === link.to)
  if (!source || !target || source.kind !== 'splitter') return null
  const axis = forwardVector(source)
  const cross = axis.x * (target.y - source.y) - axis.y * (target.x - source.x)
  if (Math.abs(cross) < 1e-7) return null
  return cross < 0 ? 'left' : 'right'
}

export function addConnection(document: DominoDocument, from: string, to: string): DominoDocument {
  if (!document.pieces.some(piece => piece.id === from) || !document.pieces.some(piece => piece.id === to)) return document
  if (document.connections.some(link => link.from === from && link.to === to)) return document
  const connection: MechanismConnection = { id: stableId('wire'), from, to, delay: 0.15, enabled: true }
  return { ...document, connections: [...document.connections, connection] }
}

export function removeConnection(document: DominoDocument, id: string): DominoDocument {
  return { ...document, connections: document.connections.filter(link => link.id !== id) }
}
