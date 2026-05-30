import { severCellsWithSingleNeighbor, type SimEdgeLookup } from './clothMeshCuts.ts';

export interface ClothGraphEdge {
  readonly id: number;
  readonly v0: number;
  readonly v1: number;
}

export interface SyncClothConnectivityOptions {
  lookup?: SimEdgeLookup;
  isVertexFixed?: (gridX: number, gridY: number) => boolean;
}

export function recomputeVertexComponents(
  vertexCount: number,
  edges: readonly ClothGraphEdge[],
  edgeActive: Uint32Array,
): Uint32Array {
  const parent = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    parent[i] = i;
  }

  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]!]!;
      node = parent[node]!;
    }
    return node;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  };

  for (const edge of edges) {
    if (edgeActive[edge.id] === 1) {
      union(edge.v0, edge.v1);
    }
  }

  const components = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    components[i] = find(i);
  }

  return components;
}

export function disconnectCrossComponentEdges(
  edges: readonly ClothGraphEdge[],
  edgeActive: Uint32Array,
  components: Uint32Array,
): boolean {
  let changed = false;

  for (const edge of edges) {
    if (edgeActive[edge.id] === 0) {
      continue;
    }

    if (components[edge.v0] !== components[edge.v1]) {
      edgeActive[edge.id] = 0;
      changed = true;
    }
  }

  return changed;
}

export function syncClothConnectivity(
  vertexCount: number,
  edges: readonly ClothGraphEdge[],
  edgeActive: Uint32Array,
  options?: SyncClothConnectivityOptions,
): { edgeActive: Uint32Array; components: Uint32Array } {
  const syncedEdges = new Uint32Array(edgeActive);
  let components = recomputeVertexComponents(vertexCount, edges, syncedEdges);

  for (let pass = 0; pass < 32; pass++) {
    let changed = disconnectCrossComponentEdges(edges, syncedEdges, components);
    components = recomputeVertexComponents(vertexCount, edges, syncedEdges);

    if (options?.lookup && options?.isVertexFixed) {
      changed =
        severCellsWithSingleNeighbor(options.lookup, syncedEdges, options.isVertexFixed) || changed;
    }

    if (!changed) {
      break;
    }
  }

  return { edgeActive: syncedEdges, components };
}

export function buildClothGraphEdges(
  edges: readonly { id: number; vertex0: { id: number }; vertex1: { id: number } }[],
): ClothGraphEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    v0: edge.vertex0.id,
    v1: edge.vertex1.id,
  }));
}

export function countConnectedComponents(components: Uint32Array): number {
  const roots = new Set<number>();
  for (let i = 0; i < components.length; i++) {
    roots.add(components[i]!);
  }
  return roots.size;
}
