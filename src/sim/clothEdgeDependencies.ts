export interface SimStructuralEdgeLookup {
  segmentsX: number;
  segmentsY: number;
  horizontal: readonly number[];
  vertical: readonly number[];
}

export interface EdgeDependencyBuffers {
  edgeDependencyStarts: Uint32Array;
  edgeDependencyIds: Uint32Array;
}

const INVALID = -1;

function horizontalId(lookup: SimStructuralEdgeLookup, x: number, y: number): number {
  if (x <= 0 || x > lookup.segmentsX || y < 0 || y > lookup.segmentsY) {
    return INVALID;
  }
  return lookup.horizontal[x * (lookup.segmentsY + 1) + y] ?? INVALID;
}

function verticalId(lookup: SimStructuralEdgeLookup, x: number, y: number): number {
  if (x < 0 || x > lookup.segmentsX || y <= 0 || y > lookup.segmentsY) {
    return INVALID;
  }
  return lookup.vertical[x * (lookup.segmentsY + 1) + y] ?? INVALID;
}

function pushUnique(ids: number[], id: number): void {
  if (id < 0 || ids.includes(id)) {
    return;
  }
  ids.push(id);
}

function quadStructuralIds(
  lookup: SimStructuralEdgeLookup,
  cellX: number,
  cellY: number,
): number[] {
  const ids: number[] = [];
  pushUnique(ids, horizontalId(lookup, cellX + 1, cellY));
  pushUnique(ids, horizontalId(lookup, cellX + 1, cellY + 1));
  pushUnique(ids, verticalId(lookup, cellX, cellY + 1));
  pushUnique(ids, verticalId(lookup, cellX + 1, cellY + 1));
  return ids;
}

export function buildEdgeStructuralDependencies(
  edges: readonly {
    id: number;
    kind: 'structural' | 'shear' | 'bend';
    vertex0: { id: number; gridX: number; gridY: number };
    vertex1: { id: number; gridX: number; gridY: number };
  }[],
  lookup: SimStructuralEdgeLookup,
): EdgeDependencyBuffers {
  const edgeDependencyLists: number[][] = edges.map(() => []);
  const structuralEdgeIdsByPair = new Map<string, number>();
  const structuralNeighbors = new Map<number, Array<{ vertexId: number; edgeId: number }>>();

  const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const addStructuralNeighbor = (from: number, to: number, edgeId: number): void => {
    const neighbors = structuralNeighbors.get(from);
    if (neighbors) {
      neighbors.push({ vertexId: to, edgeId });
    } else {
      structuralNeighbors.set(from, [{ vertexId: to, edgeId }]);
    }
  };

  for (const edge of edges) {
    if (edge.kind !== 'structural') {
      continue;
    }
    structuralEdgeIdsByPair.set(pairKey(edge.vertex0.id, edge.vertex1.id), edge.id);
    addStructuralNeighbor(edge.vertex0.id, edge.vertex1.id, edge.id);
    addStructuralNeighbor(edge.vertex1.id, edge.vertex0.id, edge.id);
  }

  for (const edge of edges) {
    const gx = edge.vertex0.gridX;
    const gy = edge.vertex0.gridY;
    const gx1 = edge.vertex1.gridX;
    const gy1 = edge.vertex1.gridY;

    if (edge.kind === 'shear') {
      const cellX = Math.min(gx, gx1);
      const cellY = Math.min(gy, gy1);
      edgeDependencyLists[edge.id] = quadStructuralIds(lookup, cellX, cellY);
      continue;
    }

    if (edge.kind === 'bend') {
      const deps: number[] = [];
      if (gx === gx1 && Math.abs(gy - gy1) === 2) {
        const y = Math.max(gy, gy1);
        pushUnique(deps, verticalId(lookup, gx, y));
        pushUnique(deps, verticalId(lookup, gx, y - 1));
      } else if (gy === gy1 && Math.abs(gx - gx1) === 2) {
        const x = Math.max(gx, gx1);
        pushUnique(deps, horizontalId(lookup, x, gy));
        pushUnique(deps, horizontalId(lookup, x - 1, gy));
      }

      for (const neighbor of structuralNeighbors.get(edge.vertex0.id) ?? []) {
        const secondEdgeId = structuralEdgeIdsByPair.get(pairKey(neighbor.vertexId, edge.vertex1.id));
        if (secondEdgeId !== undefined) {
          pushUnique(deps, neighbor.edgeId);
          pushUnique(deps, secondEdgeId);
        }
      }
      edgeDependencyLists[edge.id] = deps;
    }
  }

  const edgeCount = edges.length;
  const edgeDependencyStarts = new Uint32Array(edgeCount + 1);
  let totalDeps = 0;

  for (let i = 0; i < edgeCount; i++) {
    edgeDependencyStarts[i] = totalDeps;
    totalDeps += edgeDependencyLists[i]!.length;
  }
  edgeDependencyStarts[edgeCount] = totalDeps;

  const edgeDependencyIds = new Uint32Array(totalDeps);
  let offset = 0;
  for (let i = 0; i < edgeCount; i++) {
    for (const depId of edgeDependencyLists[i]!) {
      edgeDependencyIds[offset++] = depId;
    }
  }

  return { edgeDependencyStarts, edgeDependencyIds };
}

export function createSimStructuralEdgeLookup(
  segmentsX: number,
  segmentsY: number,
  horizontal: readonly number[],
  vertical: readonly number[],
): SimStructuralEdgeLookup {
  return { segmentsX, segmentsY, horizontal, vertical };
}
