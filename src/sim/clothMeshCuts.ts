export interface SimEdgeLookup {
  segmentsX: number;
  segmentsY: number;
  horizontal: number[];
  vertical: number[];
  shearDown: number[];
  shearUp: number[];
}

export interface ClothRenderTriangle {
  readonly i0: number;
  readonly i1: number;
  readonly i2: number;
}

export interface ClothRenderQuad {
  readonly i00: number;
  readonly i10: number;
  readonly i01: number;
  readonly i11: number;
}

export interface ClothSdfMeshingOptions {
  /** Sim-cell units. 0 disables rounded SDF caps and matches edge culling. */
  readonly holeCornerRadius: number;
  /** Optional sim-vertex components used to prevent render triangles spanning detached pieces. */
  readonly vertexComponents?: Uint32Array;
  /** Optional component visibility mask used to hide tiny detached slivers. */
  readonly renderableComponents?: Uint8Array;
}

export interface ClothSdfRenderMesh {
  readonly simGridCoords: Float32Array;
  readonly indices: Uint32Array;
}

const INVALID_EDGE = -1;
const SIM_EPS = 1e-5;
const CELL_EDGE_EPS = 1e-4;

export function createSimEdgeLookup(
  segmentsX: number,
  segmentsY: number,
  horizontal: number[],
  vertical: number[],
  shearDown: number[],
  shearUp: number[],
): SimEdgeLookup {
  return { segmentsX, segmentsY, horizontal, vertical, shearDown, shearUp };
}

function horizontalEdgeId(lookup: SimEdgeLookup, x: number, y: number): number {
  if (x <= 0 || x > lookup.segmentsX || y < 0 || y > lookup.segmentsY) {
    return INVALID_EDGE;
  }
  return lookup.horizontal[x * (lookup.segmentsY + 1) + y] ?? INVALID_EDGE;
}

function verticalEdgeId(lookup: SimEdgeLookup, x: number, y: number): number {
  if (x < 0 || x > lookup.segmentsX || y <= 0 || y > lookup.segmentsY) {
    return INVALID_EDGE;
  }
  return lookup.vertical[x * (lookup.segmentsY + 1) + y] ?? INVALID_EDGE;
}

function shearDownEdgeId(lookup: SimEdgeLookup, x: number, y: number): number {
  if (x <= 0 || x > lookup.segmentsX || y <= 0 || y > lookup.segmentsY) {
    return INVALID_EDGE;
  }
  return lookup.shearDown[x * (lookup.segmentsY + 1) + y] ?? INVALID_EDGE;
}

function shearUpEdgeId(lookup: SimEdgeLookup, x: number, y: number): number {
  if (x <= 0 || x > lookup.segmentsX || y < 0 || y >= lookup.segmentsY) {
    return INVALID_EDGE;
  }
  return lookup.shearUp[x * (lookup.segmentsY + 1) + y] ?? INVALID_EDGE;
}

function isActiveEdge(edgeId: number, edgeActive: Uint32Array): boolean {
  return edgeId >= 0 && edgeActive[edgeId] === 1;
}

interface CellNeighborLink {
  edgeId: number;
}

function listActiveCellNeighborLinks(
  lookup: SimEdgeLookup,
  cellX: number,
  cellY: number,
  edgeActive: Uint32Array,
): CellNeighborLink[] {
  const links: CellNeighborLink[] = [];

  if (cellX > 0) {
    const edgeId = verticalEdgeId(lookup, cellX, cellY + 1);
    if (isActiveEdge(edgeId, edgeActive)) {
      links.push({ edgeId });
    }
  }

  if (cellX < lookup.segmentsX - 1) {
    const edgeId = verticalEdgeId(lookup, cellX + 1, cellY + 1);
    if (isActiveEdge(edgeId, edgeActive)) {
      links.push({ edgeId });
    }
  }

  if (cellY > 0) {
    const edgeId = horizontalEdgeId(lookup, cellX + 1, cellY);
    if (isActiveEdge(edgeId, edgeActive)) {
      links.push({ edgeId });
    }
  }

  if (cellY < lookup.segmentsY - 1) {
    const edgeId = horizontalEdgeId(lookup, cellX + 1, cellY + 1);
    if (isActiveEdge(edgeId, edgeActive)) {
      links.push({ edgeId });
    }
  }

  return links;
}

/** Break the sole structural link for cells attached by one edge only (invisible strand bridges). */
export function severCellsWithSingleNeighbor(
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  isVertexFixed: (gridX: number, gridY: number) => boolean,
): boolean {
  let changed = false;

  for (const edgeId of collectSingleNeighborCellEdgeIds(lookup, edgeActive, isVertexFixed)) {
    edgeActive[edgeId] = 0;
    changed = true;
  }

  return changed;
}

function collectSingleNeighborCellEdgeIds(
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  isVertexFixed: (gridX: number, gridY: number) => boolean,
): number[] {
  const edgeIds = new Set<number>();

  for (let cellY = 0; cellY < lookup.segmentsY; cellY++) {
    for (let cellX = 0; cellX < lookup.segmentsX; cellX++) {
      if (
        isVertexFixed(cellX, cellY) ||
        isVertexFixed(cellX + 1, cellY) ||
        isVertexFixed(cellX, cellY + 1) ||
        isVertexFixed(cellX + 1, cellY + 1)
      ) {
        continue;
      }

      const links = listActiveCellNeighborLinks(lookup, cellX, cellY, edgeActive);
      if (links.length === 1) {
        edgeIds.add(links[0]!.edgeId);
      }
    }
  }

  return [...edgeIds];
}

export interface StructuralGraphEdge {
  readonly id: number;
  readonly v0: number;
  readonly v1: number;
}

export interface StrandThreadCollectionOptions {
  segmentsX: number;
  segmentsY: number;
  vertexGrid: readonly { readonly gridX: number; readonly gridY: number }[];
  lookup: SimEdgeLookup;
  isVertexFixedGrid: (gridX: number, gridY: number) => boolean;
}

/** Visual-only: uncovered structural edges plus cheap single-link cell pass. */
export function collectStrandThreadEdgeIds(
  structuralEdges: readonly StructuralGraphEdge[],
  edgeActive: Uint32Array,
  _vertexCount: number,
  isVertexFixed: (vertexId: number) => boolean,
  options: StrandThreadCollectionOptions & {
    renderQuads: readonly ClothRenderQuad[];
    simGridCoords: Float32Array;
    visibleIndices?: Uint32Array;
  },
): number[] {
  const required = new Set<number>(
    collectRequiredStrandThreadEdgeIds(structuralEdges, edgeActive, isVertexFixed, options),
  );

  for (let cellY = 0; cellY < options.segmentsY; cellY++) {
    for (let cellX = 0; cellX < options.segmentsX; cellX++) {
      if (
        options.isVertexFixedGrid(cellX, cellY) &&
        options.isVertexFixedGrid(cellX + 1, cellY) &&
        options.isVertexFixedGrid(cellX, cellY + 1) &&
        options.isVertexFixedGrid(cellX + 1, cellY + 1)
      ) {
        continue;
      }

      const links = listActiveCellNeighborLinks(options.lookup, cellX, cellY, edgeActive);
      if (links.length === 1) {
        required.add(links[0]!.edgeId);
      }
    }
  }

  return [...required];
}

/** Active structural edges with no visible render triangle lying on that sim edge. */
export function collectRequiredStrandThreadEdgeIds(
  structuralEdges: readonly StructuralGraphEdge[],
  edgeActive: Uint32Array,
  isVertexFixed: (vertexId: number) => boolean,
  options: StrandThreadCollectionOptions & {
    renderQuads: readonly ClothRenderQuad[];
    simGridCoords: Float32Array;
    visibleIndices?: Uint32Array;
  },
): number[] {
  const covered = collectRenderCoveredStructuralEdgeIds(
    options.renderQuads,
    options.simGridCoords,
    options.lookup,
    edgeActive,
    options.visibleIndices,
  );
  const required: number[] = [];

  for (const edge of structuralEdges) {
    if (edgeActive[edge.id] === 0 || isVertexFixed(edge.v0) || isVertexFixed(edge.v1)) {
      continue;
    }

    if (!covered.has(edge.id)) {
      required.push(edge.id);
    }
  }

  return required;
}

export function collectRenderCoveredStructuralEdgeIds(
  quads: readonly ClothRenderQuad[],
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  visibleIndices?: Uint32Array,
): Set<number> {
  const covered = new Set<number>();
  const visible =
    visibleIndices ??
    rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);

  for (let i = 0; i < visible.length; i += 3) {
    markRenderTriangleStructuralCoverage(
      covered,
      simGridCoords,
      lookup,
      visible[i]!,
      visible[i + 1]!,
      visible[i + 2]!,
    );
  }

  return covered;
}

function isIntegerSimCoord(value: number): boolean {
  return Math.abs(value - Math.round(value)) < SIM_EPS;
}

function markRenderTriangleStructuralCoverage(
  covered: Set<number>,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  i0: number,
  i1: number,
  i2: number,
): void {
  markRenderSegmentStructuralCoverage(covered, simGridCoords, lookup, i0, i1);
  markRenderSegmentStructuralCoverage(covered, simGridCoords, lookup, i1, i2);
  markRenderSegmentStructuralCoverage(covered, simGridCoords, lookup, i2, i0);
}

function markRenderSegmentStructuralCoverage(
  covered: Set<number>,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  a: number,
  b: number,
): void {
  const p0 = getSimCoord(simGridCoords, a);
  const p1 = getSimCoord(simGridCoords, b);

  if (Math.abs(p0.y - p1.y) < SIM_EPS && isIntegerSimCoord(p0.y)) {
    const y = Math.round(p0.y);
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    if (maxX - minX < SIM_EPS) {
      return;
    }

    for (let ix = Math.ceil(minX - SIM_EPS); ix <= Math.floor(maxX + SIM_EPS); ix++) {
      if (ix >= 1 && ix <= lookup.segmentsX) {
        const edgeId = horizontalEdgeId(lookup, ix, y);
        if (edgeId >= 0) {
          covered.add(edgeId);
        }
      }
    }
    return;
  }

  if (Math.abs(p0.x - p1.x) < SIM_EPS && isIntegerSimCoord(p0.x)) {
    const x = Math.round(p0.x);
    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p0.y, p1.y);
    if (maxY - minY < SIM_EPS) {
      return;
    }

    for (let iy = Math.ceil(minY - SIM_EPS); iy <= Math.floor(maxY + SIM_EPS); iy++) {
      if (iy >= 1 && iy <= lookup.segmentsY) {
        const edgeId = verticalEdgeId(lookup, x, iy);
        if (edgeId >= 0) {
          covered.add(edgeId);
        }
      }
    }
  }
}

export function auditStrandThreadCoverage(
  structuralEdges: readonly StructuralGraphEdge[],
  edgeActive: Uint32Array,
  renderedEdgeIds: readonly number[],
  vertexCount: number,
  isVertexFixed: (vertexId: number) => boolean,
  options: StrandThreadCollectionOptions & {
    renderQuads: readonly ClothRenderQuad[];
    simGridCoords: Float32Array;
  },
): {
  required: number[];
  rendered: number[];
  missing: number[];
  extra: number[];
} {
  const required = collectStrandThreadEdgeIds(
    structuralEdges,
    edgeActive,
    vertexCount,
    isVertexFixed,
    options,
  );
  const requiredSet = new Set(required);
  const renderedSet = new Set(renderedEdgeIds);
  const missing = required.filter((edgeId) => !renderedSet.has(edgeId));
  const extra = renderedEdgeIds.filter((edgeId) => !requiredSet.has(edgeId));

  return { required, rendered: [...renderedEdgeIds], missing, extra };
}

function isBrokenEdge(edgeId: number, edgeActive: Uint32Array): boolean {
  return edgeId >= 0 && edgeActive[edgeId] === 0;
}

function getSimCoord(
  simGridCoords: Float32Array,
  vertexIndex: number,
): { x: number; y: number } {
  return {
    x: simGridCoords[vertexIndex * 2]!,
    y: simGridCoords[vertexIndex * 2 + 1]!,
  };
}

function clampCellCoord(value: number, maxCell: number): number {
  let cell = Math.floor(value + SIM_EPS);
  if (cell >= maxCell) {
    cell = maxCell - 1;
  }
  if (cell < 0) {
    cell = 0;
  }
  return cell;
}

interface CellSpan {
  minFx: number;
  maxFx: number;
  minFy: number;
  maxFy: number;
}

function triangleCrossesBrokenWorldEdge(
  simXs: number[],
  simYs: number[],
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): boolean {
  const minX = Math.min(...simXs);
  const maxX = Math.max(...simXs);
  const minY = Math.min(...simYs);
  const maxY = Math.max(...simYs);

  for (let ix = 1; ix <= lookup.segmentsX; ix++) {
    if (!(minX < ix - SIM_EPS && maxX > ix - SIM_EPS)) {
      continue;
    }

    for (let iy = 1; iy <= lookup.segmentsY; iy++) {
      const edgeId = verticalEdgeId(lookup, ix, iy);
      if (!isBrokenEdge(edgeId, edgeActive)) {
        continue;
      }

      const edgeY0 = iy - 1;
      const edgeY1 = iy;
      if (maxY < edgeY0 + SIM_EPS || minY > edgeY1 - SIM_EPS) {
        continue;
      }

      return true;
    }
  }

  for (let iy = 0; iy <= lookup.segmentsY; iy++) {
    if (!(minY < iy - SIM_EPS && maxY > iy - SIM_EPS)) {
      continue;
    }

    for (let ix = 1; ix <= lookup.segmentsX; ix++) {
      const edgeId = horizontalEdgeId(lookup, ix, iy);
      if (!isBrokenEdge(edgeId, edgeActive)) {
        continue;
      }

      const edgeX0 = ix - 1;
      const edgeX1 = ix;
      if (maxX < edgeX0 + SIM_EPS || minX > edgeX1 - SIM_EPS) {
        continue;
      }

      return true;
    }
  }

  return false;
}

function triangleBridgesBrokenCellInterior(
  triangle: ClothRenderTriangle,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): boolean {
  const spans = new Map<string, CellSpan>();

  for (const vertexIndex of [triangle.i0, triangle.i1, triangle.i2]) {
    const { x, y } = getSimCoord(simGridCoords, vertexIndex);
    const cellX = clampCellCoord(x, lookup.segmentsX);
    const cellY = clampCellCoord(y, lookup.segmentsY);
    const key = `${cellX},${cellY}`;
    const localFx = x - cellX;
    const localFy = y - cellY;
    const existing = spans.get(key);

    if (!existing) {
      spans.set(key, {
        minFx: localFx,
        maxFx: localFx,
        minFy: localFy,
        maxFy: localFy,
      });
      continue;
    }

    existing.minFx = Math.min(existing.minFx, localFx);
    existing.maxFx = Math.max(existing.maxFx, localFx);
    existing.minFy = Math.min(existing.minFy, localFy);
    existing.maxFy = Math.max(existing.maxFy, localFy);
  }

  for (const [key, span] of spans) {
    const [cellXText, cellYText] = key.split(',');
    const cellX = Number(cellXText);
    const cellY = Number(cellYText);

    const bottomEdgeId = horizontalEdgeId(lookup, cellX + 1, cellY);
    const topEdgeId = horizontalEdgeId(lookup, cellX + 1, cellY + 1);

    const bottomBroken = isBrokenEdge(bottomEdgeId, edgeActive);
    const topBroken = isBrokenEdge(topEdgeId, edgeActive);

    const spansSouthEdge = span.minFy < CELL_EDGE_EPS && span.maxFy > CELL_EDGE_EPS;
    const spansNorthEdge = span.minFy < 1 - CELL_EDGE_EPS && span.maxFy > 1 - CELL_EDGE_EPS;

    if (bottomBroken && spansSouthEdge) {
      return true;
    }
    if (topBroken && spansNorthEdge) {
      return true;
    }
    if (bottomBroken && topBroken) {
      const spansMidFx = span.minFx < 0.5 - CELL_EDGE_EPS && span.maxFx > 0.5 + CELL_EDGE_EPS;
      const spansMidFy = span.minFy < 0.5 - CELL_EDGE_EPS && span.maxFy > 0.5 + CELL_EDGE_EPS;
      if (spansMidFx || spansMidFy) {
        return true;
      }
    }
  }

  return false;
}

export function triangleCrossesBrokenStructuralEdge(
  triangle: ClothRenderTriangle,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): boolean {
  const p0 = getSimCoord(simGridCoords, triangle.i0);
  const p1 = getSimCoord(simGridCoords, triangle.i1);
  const p2 = getSimCoord(simGridCoords, triangle.i2);
  const simXs = [p0.x, p1.x, p2.x];
  const simYs = [p0.y, p1.y, p2.y];

  if (triangleCrossesBrokenWorldEdge(simXs, simYs, lookup, edgeActive)) {
    return true;
  }

  if (triangleBridgesBrokenCellInterior(triangle, simGridCoords, lookup, edgeActive)) {
    return true;
  }

  return false;
}

export function buildClothRenderTriangles(indices: number[]): ClothRenderTriangle[] {
  const triangles: ClothRenderTriangle[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    triangles.push({
      i0: indices[i]!,
      i1: indices[i + 1]!,
      i2: indices[i + 2]!,
    });
  }

  return triangles;
}

export function buildClothRenderQuads(indices: number[]): ClothRenderQuad[] {
  const quads: ClothRenderQuad[] = [];

  for (let i = 0; i < indices.length; i += 6) {
    quads.push({
      i00: indices[i]!,
      i10: indices[i + 1]!,
      i01: indices[i + 2]!,
      i11: indices[i + 4]!,
    });
  }

  return quads;
}

function quadSimCell(
  quad: ClothRenderQuad,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
): { cellX: number; cellY: number } {
  const { x, y } = getSimCoord(simGridCoords, quad.i00);
  return {
    cellX: clampCellCoord(x, lookup.segmentsX),
    cellY: clampCellCoord(y, lookup.segmentsY),
  };
}

function quadShearState(
  cellX: number,
  cellY: number,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): { shearUpBroken: boolean; shearDownBroken: boolean } {
  return {
    shearUpBroken: isBrokenEdge(shearUpEdgeId(lookup, cellX + 1, cellY), edgeActive),
    shearDownBroken: isBrokenEdge(shearDownEdgeId(lookup, cellX + 1, cellY + 1), edgeActive),
  };
}

function quadTriangles(
  quad: ClothRenderQuad,
  useAlternateDiagonal: boolean,
): [ClothRenderTriangle, ClothRenderTriangle] {
  if (useAlternateDiagonal) {
    return [
      { i0: quad.i00, i1: quad.i10, i2: quad.i11 },
      { i0: quad.i00, i1: quad.i11, i2: quad.i01 },
    ];
  }

  return [
    { i0: quad.i00, i1: quad.i10, i2: quad.i01 },
    { i0: quad.i10, i1: quad.i11, i2: quad.i01 },
  ];
}

function shouldUseAlternateQuadDiagonal(
  shearUpBroken: boolean,
  shearDownBroken: boolean,
): boolean {
  if (shearUpBroken && !shearDownBroken) {
    return true;
  }

  if (shearDownBroken && !shearUpBroken) {
    return false;
  }

  return shearUpBroken;
}

export function rebuildClothIndicesFromEdgeState(
  quads: readonly ClothRenderQuad[],
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): Uint32Array {
  const visible: number[] = [];

  for (const quad of quads) {
    const { cellX, cellY } = quadSimCell(quad, simGridCoords, lookup);
    const { shearUpBroken, shearDownBroken } = quadShearState(cellX, cellY, lookup, edgeActive);

    if (shearUpBroken && shearDownBroken) {
      continue;
    }

    const useAlternateDiagonal = shouldUseAlternateQuadDiagonal(shearUpBroken, shearDownBroken);
    const candidates = quadTriangles(quad, useAlternateDiagonal);

    for (const triangle of candidates) {
      if (triangleCrossesBrokenStructuralEdge(triangle, simGridCoords, lookup, edgeActive)) {
        continue;
      }

      visible.push(triangle.i0, triangle.i1, triangle.i2);
    }
  }

  return new Uint32Array(visible);
}

function triangleCentroid(
  triangle: ClothRenderTriangle,
  simGridCoords: Float32Array,
): { x: number; y: number } {
  const p0 = getSimCoord(simGridCoords, triangle.i0);
  const p1 = getSimCoord(simGridCoords, triangle.i1);
  const p2 = getSimCoord(simGridCoords, triangle.i2);
  return {
    x: (p0.x + p1.x + p2.x) / 3,
    y: (p0.y + p1.y + p2.y) / 3,
  };
}

function roundedBoxSdf(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  halfX: number,
  halfY: number,
  radius: number,
): number {
  const innerHalfX = Math.max(0, halfX - radius);
  const innerHalfY = Math.max(0, halfY - radius);
  const qx = Math.abs(x - centerX) - innerHalfX;
  const qy = Math.abs(y - centerY) - innerHalfY;
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  return Math.hypot(outsideX, outsideY) + Math.min(Math.max(qx, qy), 0) - radius;
}

function isSdfHoleCell(
  cellX: number,
  cellY: number,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): boolean {
  const { shearUpBroken, shearDownBroken } = quadShearState(cellX, cellY, lookup, edgeActive);
  if (shearUpBroken && shearDownBroken) {
    return true;
  }

  const structuralIds = [
    horizontalEdgeId(lookup, cellX + 1, cellY),
    horizontalEdgeId(lookup, cellX + 1, cellY + 1),
    verticalEdgeId(lookup, cellX, cellY + 1),
    verticalEdgeId(lookup, cellX + 1, cellY + 1),
  ];
  let brokenStructural = 0;
  for (const edgeId of structuralIds) {
    if (isBrokenEdge(edgeId, edgeActive)) {
      brokenStructural += 1;
    }
  }

  return brokenStructural >= 3;
}

function triangleInsideSdfHole(
  triangle: ClothRenderTriangle,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  radius: number,
): boolean {
  if (radius <= 0) {
    return false;
  }

  const centroid = triangleCentroid(triangle, simGridCoords);
  const centerCellX = clampCellCoord(centroid.x, lookup.segmentsX);
  const centerCellY = clampCellCoord(centroid.y, lookup.segmentsY);
  const clampedRadius = Math.min(0.49, Math.max(0, radius));

  for (let cellX = Math.max(0, centerCellX - 1); cellX <= Math.min(lookup.segmentsX - 1, centerCellX + 1); cellX++) {
    for (let cellY = Math.max(0, centerCellY - 1); cellY <= Math.min(lookup.segmentsY - 1, centerCellY + 1); cellY++) {
      if (!isSdfHoleCell(cellX, cellY, lookup, edgeActive)) {
        continue;
      }

      const sdf = roundedBoxSdf(
        centroid.x,
        centroid.y,
        cellX + 0.5,
        cellY + 0.5,
        0.5,
        0.5,
        clampedRadius,
      );

      if (sdf < 0) {
        return true;
      }
    }
  }

  return false;
}

export function rebuildClothIndicesFromSdfEdgeState(
  quads: readonly ClothRenderQuad[],
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  options: ClothSdfMeshingOptions,
): Uint32Array {
  const visible: number[] = [];

  for (const quad of quads) {
    const { cellX, cellY } = quadSimCell(quad, simGridCoords, lookup);
    const { shearUpBroken, shearDownBroken } = quadShearState(cellX, cellY, lookup, edgeActive);
    const useAlternateDiagonal = shouldUseAlternateQuadDiagonal(shearUpBroken, shearDownBroken);
    const candidates = quadTriangles(quad, useAlternateDiagonal);

    for (const triangle of candidates) {
      if (triangleCrossesBrokenStructuralEdge(triangle, simGridCoords, lookup, edgeActive)) {
        continue;
      }

      if (triangleInsideSdfHole(triangle, simGridCoords, lookup, edgeActive, options.holeCornerRadius)) {
        continue;
      }

      visible.push(triangle.i0, triangle.i1, triangle.i2);
    }
  }

  return new Uint32Array(visible);
}

interface SdfPolygonVertex {
  readonly x: number;
  readonly y: number;
}

function interpolatePolygonVertex(
  a: SdfPolygonVertex,
  b: SdfPolygonVertex,
  t: number,
): SdfPolygonVertex {
  const clampedT = Math.min(1, Math.max(0, t));
  return {
    x: a.x + (b.x - a.x) * clampedT,
    y: a.y + (b.y - a.y) * clampedT,
  };
}

function clipPolygonOutsideRoundedBox(
  polygon: readonly SdfPolygonVertex[],
  holeCellX: number,
  holeCellY: number,
  radius: number,
): SdfPolygonVertex[] {
  if (polygon.length === 0) {
    return [];
  }

  const clipped: SdfPolygonVertex[] = [];
  const centerX = holeCellX + 0.5;
  const centerY = holeCellY + 0.5;
  const evalSdf = (point: SdfPolygonVertex) =>
    roundedBoxSdf(point.x, point.y, centerX, centerY, 0.5, 0.5, radius);

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const currentDistance = evalSdf(current);
    const nextDistance = evalSdf(next);
    const currentOutside = currentDistance >= 0;
    const nextOutside = nextDistance >= 0;

    if (currentOutside && nextOutside) {
      clipped.push(next);
      continue;
    }

    if (currentOutside !== nextOutside) {
      const t = currentDistance / (currentDistance - nextDistance || 1);
      clipped.push(interpolatePolygonVertex(current, next, t));
    }

    if (!currentOutside && nextOutside) {
      clipped.push(next);
    }
  }

  return clipped;
}

function triangleSdfHoleCandidates(
  triangle: ClothRenderTriangle,
  simGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
): { cellX: number; cellY: number }[] {
  const p0 = getSimCoord(simGridCoords, triangle.i0);
  const p1 = getSimCoord(simGridCoords, triangle.i1);
  const p2 = getSimCoord(simGridCoords, triangle.i2);
  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)) - 1);
  const maxX = Math.min(lookup.segmentsX - 1, Math.floor(Math.max(p0.x, p1.x, p2.x)) + 1);
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)) - 1);
  const maxY = Math.min(lookup.segmentsY - 1, Math.floor(Math.max(p0.y, p1.y, p2.y)) + 1);
  const candidates: { cellX: number; cellY: number }[] = [];

  for (let cellX = minX; cellX <= maxX; cellX++) {
    for (let cellY = minY; cellY <= maxY; cellY++) {
      if (isSdfHoleCell(cellX, cellY, lookup, edgeActive)) {
        candidates.push({ cellX, cellY });
      }
    }
  }

  return candidates;
}

function polygonHasConsistentSide(
  polygon: readonly SdfPolygonVertex[],
  signedDistance: (point: SdfPolygonVertex) => number,
): boolean {
  let hasNegative = false;
  let hasPositive = false;

  for (const point of polygon) {
    const distance = signedDistance(point);
    if (distance < -CELL_EDGE_EPS) {
      hasNegative = true;
    } else if (distance > CELL_EDGE_EPS) {
      hasPositive = true;
    }

    if (hasNegative && hasPositive) {
      return false;
    }
  }

  return true;
}

function polygonStaysWithinBrokenShearRegion(
  polygon: readonly SdfPolygonVertex[],
  cellX: number,
  cellY: number,
  shearUpBroken: boolean,
  shearDownBroken: boolean,
): boolean {
  if (!shearUpBroken && !shearDownBroken) {
    return true;
  }

  if (shearUpBroken && !polygonHasConsistentSide(polygon, (point) => point.x + point.y - (cellX + cellY + 1))) {
    return false;
  }

  if (shearDownBroken && !polygonHasConsistentSide(polygon, (point) => point.y - point.x + cellX - cellY)) {
    return false;
  }

  return true;
}

function simVertexIndex(lookup: SimEdgeLookup, gridX: number, gridY: number): number {
  return gridX * (lookup.segmentsY + 1) + gridY;
}

function nearestComponentForPoint(
  point: SdfPolygonVertex,
  lookup: SimEdgeLookup,
  vertexComponents: Uint32Array,
): number {
  const cx = Math.min(lookup.segmentsX, Math.max(0, point.x));
  const cy = Math.min(lookup.segmentsY, Math.max(0, point.y));
  const gridX = Math.min(lookup.segmentsX, Math.max(0, Math.round(cx)));
  const gridY = Math.min(lookup.segmentsY, Math.max(0, Math.round(cy)));
  return vertexComponents[simVertexIndex(lookup, gridX, gridY)] ?? 0xffffffff;
}

function polygonStaysWithinSingleComponent(
  polygon: readonly SdfPolygonVertex[],
  lookup: SimEdgeLookup,
  vertexComponents?: Uint32Array,
  renderableComponents?: Uint8Array,
): boolean {
  if (!vertexComponents || polygon.length === 0) {
    return true;
  }

  const component = nearestComponentForPoint(polygon[0]!, lookup, vertexComponents);
  if (renderableComponents && renderableComponents[component] !== 1) {
    return false;
  }

  for (let i = 1; i < polygon.length; i++) {
    if (nearestComponentForPoint(polygon[i]!, lookup, vertexComponents) !== component) {
      return false;
    }
  }

  return true;
}

export function buildClothSdfRenderMesh(
  quads: readonly ClothRenderQuad[],
  sourceSimGridCoords: Float32Array,
  lookup: SimEdgeLookup,
  edgeActive: Uint32Array,
  options: ClothSdfMeshingOptions,
): ClothSdfRenderMesh {
  const simGridCoords: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<string, number>();
  const radius = Math.min(0.49, Math.max(0, options.holeCornerRadius));

  const addVertex = (point: SdfPolygonVertex): number => {
    const key = `${point.x.toFixed(5)},${point.y.toFixed(5)}`;
    const existing = vertexIds.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const index = simGridCoords.length / 2;
    vertexIds.set(key, index);
    simGridCoords.push(point.x, point.y);
    return index;
  };

  for (const quad of quads) {
    const { cellX, cellY } = quadSimCell(quad, sourceSimGridCoords, lookup);
    const { shearUpBroken, shearDownBroken } = quadShearState(cellX, cellY, lookup, edgeActive);
    const useAlternateDiagonal = shouldUseAlternateQuadDiagonal(shearUpBroken, shearDownBroken);
    const candidates = quadTriangles(quad, useAlternateDiagonal);

    for (const triangle of candidates) {
      if (triangleCrossesBrokenStructuralEdge(triangle, sourceSimGridCoords, lookup, edgeActive)) {
        continue;
      }

      let polygon: SdfPolygonVertex[] = [
        getSimCoord(sourceSimGridCoords, triangle.i0),
        getSimCoord(sourceSimGridCoords, triangle.i1),
        getSimCoord(sourceSimGridCoords, triangle.i2),
      ];

      if (radius > 0) {
        for (const hole of triangleSdfHoleCandidates(triangle, sourceSimGridCoords, lookup, edgeActive)) {
          polygon = clipPolygonOutsideRoundedBox(polygon, hole.cellX, hole.cellY, radius);
          if (polygon.length < 3) {
            break;
          }
        }
      }

      if (polygon.length < 3) {
        continue;
      }

      if (
        !polygonStaysWithinSingleComponent(
          polygon,
          lookup,
          options.vertexComponents,
          options.renderableComponents,
        )
      ) {
        continue;
      }

      if (
        !polygonStaysWithinBrokenShearRegion(
          polygon,
          cellX,
          cellY,
          shearUpBroken,
          shearDownBroken,
        )
      ) {
        continue;
      }

      const startIndex = addVertex(polygon[0]!);
      for (let i = 1; i < polygon.length - 1; i++) {
        indices.push(startIndex, addVertex(polygon[i]!), addVertex(polygon[i + 1]!));
      }
    }
  }

  return {
    simGridCoords: new Float32Array(simGridCoords),
    indices: new Uint32Array(indices),
  };
}

export function countBrokenEdges(edgeActive: Uint32Array): number {
  let count = 0;
  for (let i = 0; i < edgeActive.length; i++) {
    if (edgeActive[i] === 0) {
      count += 1;
    }
  }
  return count;
}
