import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClothRenderQuads,
  buildClothSdfRenderMesh,
  collectStrandThreadEdgeIds,
  collectRequiredStrandThreadEdgeIds,
  collectAssemblyStrandThreadEdgeIds,
  collectParticleRenderCoveredEdgeIds,
  rebuildClothIndicesFromEdgeState,
  rebuildClothIndicesFromSdfEdgeState,
  buildGpuParticleRenderSurface,
  rebuildParticleRenderIndices,
  severCellsWithSingleNeighbor,
  triangleCrossesBrokenStructuralEdge,
  type SimEdgeLookup,
  type StructuralGraphEdge,
} from './clothMeshCuts.ts';
import { buildEdgeStructuralDependencies, createSimStructuralEdgeLookup } from './clothEdgeDependencies.ts';

function makeStructuralLookup(segmentsX: number, segmentsY: number): {
  lookup: SimEdgeLookup;
  edgeCount: number;
} {
  const size = (segmentsX + 1) * (segmentsY + 1);
  const horizontal = new Array<number>(size).fill(-1);
  const vertical = new Array<number>(size).fill(-1);
  const shearDown = new Array<number>(size).fill(-1);
  const shearUp = new Array<number>(size).fill(-1);
  let edgeId = 0;

  for (let x = 0; x <= segmentsX; x++) {
    for (let y = 0; y <= segmentsY; y++) {
      if (x > 0) {
        horizontal[x * (segmentsY + 1) + y] = edgeId++;
      }
      if (y > 0) {
        vertical[x * (segmentsY + 1) + y] = edgeId++;
      }
      if (x > 0 && y > 0) {
        shearDown[x * (segmentsY + 1) + y] = edgeId++;
      }
      if (x > 0 && y < segmentsY) {
        shearUp[x * (segmentsY + 1) + y] = edgeId++;
      }
    }
  }

  return {
    lookup: {
      segmentsX,
      segmentsY,
      horizontal,
      vertical,
      shearDown,
      shearUp,
    },
    edgeCount: edgeId,
  };
}

function vertexId(segmentsY: number, gridX: number, gridY: number): number {
  return gridX * (segmentsY + 1) + gridY;
}

function makeStructuralGraphFromLookup(lookup: SimEdgeLookup): StructuralGraphEdge[] {
  const edges: StructuralGraphEdge[] = [];

  for (let x = 0; x <= lookup.segmentsX; x++) {
    for (let y = 0; y <= lookup.segmentsY; y++) {
      const idx = x * (lookup.segmentsY + 1) + y;
      if (x > 0) {
        edges.push({
          id: lookup.horizontal[idx]!,
          v0: vertexId(lookup.segmentsY, x - 1, y),
          v1: vertexId(lookup.segmentsY, x, y),
        });
      }
      if (y > 0) {
        edges.push({
          id: lookup.vertical[idx]!,
          v0: vertexId(lookup.segmentsY, x, y - 1),
          v1: vertexId(lookup.segmentsY, x, y),
        });
      }
    }
  }

  return edges;
}

function makeVertexGrid(segmentsX: number, segmentsY: number): { gridX: number; gridY: number }[] {
  const grid: { gridX: number; gridY: number }[] = [];
  for (let x = 0; x <= segmentsX; x++) {
    for (let y = 0; y <= segmentsY; y++) {
      grid.push({ gridX: x, gridY: y });
    }
  }
  return grid;
}

function makeStrandOptions(
  lookup: SimEdgeLookup,
  vertexGrid: { gridX: number; gridY: number }[],
): {
  segmentsX: number;
  segmentsY: number;
  vertexGrid: { gridX: number; gridY: number }[];
  lookup: SimEdgeLookup;
  isVertexFixedGrid: (gridX: number, gridY: number) => boolean;
  renderQuads: ReturnType<typeof buildClothRenderQuads>;
  simGridCoords: Float32Array;
} {
  const simGridCoords = new Float32Array((lookup.segmentsX + 1) * (lookup.segmentsY + 1) * 2);
  for (let x = 0; x <= lookup.segmentsX; x++) {
    for (let y = 0; y <= lookup.segmentsY; y++) {
      const idx = (x * (lookup.segmentsY + 1) + y) * 2;
      simGridCoords[idx] = x;
      simGridCoords[idx + 1] = y;
    }
  }

  const renderVertexCount = (lookup.segmentsX + 1) * (lookup.segmentsY + 1);
  const quadIndices: number[] = [];
  for (let cellY = 0; cellY < lookup.segmentsY; cellY++) {
    for (let cellX = 0; cellX < lookup.segmentsX; cellX++) {
      const i00 = cellX * (lookup.segmentsY + 1) + cellY;
      const i10 = (cellX + 1) * (lookup.segmentsY + 1) + cellY;
      const i01 = cellX * (lookup.segmentsY + 1) + cellY + 1;
      const i11 = (cellX + 1) * (lookup.segmentsY + 1) + cellY + 1;
      quadIndices.push(i00, i10, i01, i10, i11, i01);
    }
  }

  return {
    segmentsX: lookup.segmentsX,
    segmentsY: lookup.segmentsY,
    vertexGrid,
    lookup,
    isVertexFixedGrid: () => false,
    renderQuads: buildClothRenderQuads(quadIndices),
    simGridCoords,
  };
}

function makeRenderGrid(
  segmentsX: number,
  segmentsY: number,
  renderSubdivisions: number,
): { indices: number[]; simGridCoords: Float32Array } {
  const renderCellsX = segmentsX * renderSubdivisions;
  const renderCellsY = segmentsY * renderSubdivisions;
  const renderGridSizeY = renderCellsY + 1;
  const simGridCoords = new Float32Array((renderCellsX + 1) * renderGridSizeY * 2);
  const indices: number[] = [];

  const getRenderIndex = (gridX: number, gridY: number) => gridX * renderGridSizeY + gridY;

  for (let gridX = 0; gridX <= renderCellsX; gridX++) {
    for (let gridY = 0; gridY <= renderCellsY; gridY++) {
      const index = getRenderIndex(gridX, gridY);
      simGridCoords[index * 2] = gridX / renderSubdivisions;
      simGridCoords[index * 2 + 1] = gridY / renderSubdivisions;
    }
  }

  for (let gridX = 0; gridX < renderCellsX; gridX++) {
    for (let gridY = 0; gridY < renderCellsY; gridY++) {
      const i00 = getRenderIndex(gridX, gridY);
      const i10 = getRenderIndex(gridX + 1, gridY);
      const i01 = getRenderIndex(gridX, gridY + 1);
      const i11 = getRenderIndex(gridX + 1, gridY + 1);
      indices.push(i00, i10, i01, i10, i11, i01);
    }
  }

  return { indices, simGridCoords };
}

test('keeps triangles when all structural edges are intact', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const simGridCoords = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const visible = rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);

  assert.equal(visible.length, 6);
});

test('culls triangles that cross a broken structural edge', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[3] = 0;

  const simGridCoords = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  const spanningTriangle = { i0: 0, i1: 1, i2: 2 };
  assert.equal(
    triangleCrossesBrokenStructuralEdge(spanningTriangle, simGridCoords, lookup, edgeActive),
    true,
  );

  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const visible = rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);
  assert.equal(visible.length, 0);
});

test('culls render triangles that span a torn vertical sim edge', () => {
  const { lookup, edgeCount } = makeStructuralLookup(2, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const verticalTearId = lookup.vertical[1 * (lookup.segmentsY + 1) + 1]!;
  edgeActive[verticalTearId] = 0;

  const simGridCoords = new Float32Array([
    0.75, 0.2,
    1.0, 0.2,
    0.75, 0.8,
  ]);
  const boundaryTriangle = { i0: 0, i1: 1, i2: 2 };

  assert.equal(
    triangleCrossesBrokenStructuralEdge(boundaryTriangle, simGridCoords, lookup, edgeActive),
    true,
  );
});

test('culls triangles that bridge a broken bottom edge inside a sim cell', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[1] = 0;

  const simGridCoords = new Float32Array([
    0.1, 0,
    0.9, 0,
    0.1, 0.5,
  ]);
  const bridgingTriangle = { i0: 0, i1: 1, i2: 2 };
  assert.equal(
    triangleCrossesBrokenStructuralEdge(bridgingTriangle, simGridCoords, lookup, edgeActive),
    true,
  );
});

test('keeps triangles fully on one side of a vertical tear', () => {
  const { lookup, edgeCount } = makeStructuralLookup(2, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const verticalTearId = lookup.vertical[1 * (lookup.segmentsY + 1) + 1]!;
  edgeActive[verticalTearId] = 0;

  const simGridCoords = new Float32Array([
    0.1, 0.2,
    0.4, 0.2,
    0.2, 0.8,
    1.6, 0.2,
    1.9, 0.2,
    1.7, 0.8,
  ]);
  const leftTriangle = { i0: 0, i1: 1, i2: 2 };
  const rightTriangle = { i0: 3, i1: 4, i2: 5 };

  assert.equal(
    triangleCrossesBrokenStructuralEdge(leftTriangle, simGridCoords, lookup, edgeActive),
    false,
  );
  assert.equal(
    triangleCrossesBrokenStructuralEdge(rightTriangle, simGridCoords, lookup, edgeActive),
    false,
  );
});

test('flips render quad diagonal when the shear-up edge is broken', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const shearUpEdgeId = lookup.shearUp[2]!;
  edgeActive[shearUpEdgeId] = 0;

  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const visible = rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);

  assert.equal(visible.length, 6);
  assert.deepEqual(Array.from(visible), [0, 1, 3, 0, 3, 2]);
});

test('drops render quads when both shear diagonals are broken', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[lookup.shearUp[2]!] = 0;
  edgeActive[lookup.shearDown[3]!] = 0;

  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const visible = rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);

  assert.equal(visible.length, 0);
});

test('SDF meshing rounds a square shear hole instead of dropping the full cell', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[lookup.shearUp[2]!] = 0;
  edgeActive[lookup.shearDown[3]!] = 0;

  const { indices, simGridCoords } = makeRenderGrid(1, 1, 4);
  const quads = buildClothRenderQuads(indices);
  const edgeCulled = rebuildClothIndicesFromEdgeState(quads, simGridCoords, lookup, edgeActive);
  const sdfMeshed = rebuildClothIndicesFromSdfEdgeState(quads, simGridCoords, lookup, edgeActive, {
    holeCornerRadius: 0.35,
  });

  assert.equal(edgeCulled.length, 0);
  assert.ok(sdfMeshed.length > 0);
  assert.ok(sdfMeshed.length < indices.length);
});

test('SDF render mesh creates boundary vertices on rounded hole contours', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[lookup.shearUp[2]!] = 0;
  edgeActive[lookup.shearDown[3]!] = 0;

  const { indices, simGridCoords } = makeRenderGrid(1, 1, 4);
  const mesh = buildClothSdfRenderMesh(
    buildClothRenderQuads(indices),
    simGridCoords,
    lookup,
    edgeActive,
    { holeCornerRadius: 0.35 },
  );
  const sourceVertexCount = simGridCoords.length / 2;
  const dynamicVertexCount = mesh.simGridCoords.length / 2;

  assert.ok(mesh.indices.length > 0);
  assert.ok(dynamicVertexCount > 0);
  assert.ok(dynamicVertexCount !== sourceVertexCount);
});

test('SDF render mesh does not bridge across fully broken shear regions', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  edgeActive[lookup.shearUp[2]!] = 0;
  edgeActive[lookup.shearDown[3]!] = 0;

  const { indices, simGridCoords } = makeRenderGrid(1, 1, 6);
  const mesh = buildClothSdfRenderMesh(
    buildClothRenderQuads(indices),
    simGridCoords,
    lookup,
    edgeActive,
    { holeCornerRadius: 0.35 },
  );

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!];
    const shearUpSides = tri.map((index) => {
      const x = mesh.simGridCoords[index * 2]!;
      const y = mesh.simGridCoords[index * 2 + 1]!;
      return Math.sign(Math.abs(x + y - 1) < 1e-4 ? 0 : x + y - 1);
    });
    const shearDownSides = tri.map((index) => {
      const x = mesh.simGridCoords[index * 2]!;
      const y = mesh.simGridCoords[index * 2 + 1]!;
      return Math.sign(Math.abs(y - x) < 1e-4 ? 0 : y - x);
    });

    assert.ok(!shearUpSides.includes(-1) || !shearUpSides.includes(1));
    assert.ok(!shearDownSides.includes(-1) || !shearDownSides.includes(1));
  }
});

test('SDF render mesh culls polygons spanning detached vertex components', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const components = new Uint32Array([0, 1, 0, 1]);

  const mesh = buildClothSdfRenderMesh(quads, simGridCoords, lookup, edgeActive, {
    holeCornerRadius: 0.35,
    vertexComponents: components,
  });

  assert.equal(mesh.indices.length, 0);
});

test('SDF render mesh culls hidden detached components', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const components = new Uint32Array([1, 1, 1, 1]);
  const renderableComponents = new Uint8Array(2);

  const mesh = buildClothSdfRenderMesh(quads, simGridCoords, lookup, edgeActive, {
    holeCornerRadius: 0.35,
    vertexComponents: components,
    renderableComponents,
  });

  assert.equal(mesh.indices.length, 0);
});

test('SDF render mesh keeps visible detached components', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quads = buildClothRenderQuads([0, 1, 2, 1, 3, 2]);
  const components = new Uint32Array([1, 1, 1, 1]);
  const renderableComponents = new Uint8Array(2);
  renderableComponents[1] = 1;

  const mesh = buildClothSdfRenderMesh(quads, simGridCoords, lookup, edgeActive, {
    holeCornerRadius: 0.35,
    vertexComponents: components,
    renderableComponents,
  });

  assert.ok(mesh.indices.length > 0);
});

test('severs interior cells that connect to only one other cell', () => {
  const { lookup, edgeCount } = makeStructuralLookup(3, 3);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const cellX = 1;
  const cellY = 1;

  const westId = lookup.vertical[cellX * (lookup.segmentsY + 1) + (cellY + 1)]!;
  const eastId = lookup.vertical[(cellX + 1) * (lookup.segmentsY + 1) + (cellY + 1)]!;
  const southId = lookup.horizontal[(cellX + 1) * (lookup.segmentsY + 1) + cellY]!;
  const northId = lookup.horizontal[(cellX + 1) * (lookup.segmentsY + 1) + (cellY + 1)]!;

  edgeActive[westId] = 0;
  edgeActive[southId] = 0;
  edgeActive[northId] = 0;

  assert.equal(
    severCellsWithSingleNeighbor(lookup, edgeActive, () => false),
    true,
  );
  assert.equal(edgeActive[eastId], 0);
  assert.equal(edgeActive[westId], 0);
});

test('severs boundary cells that connect to only one other cell', () => {
  const { lookup, edgeCount } = makeStructuralLookup(3, 3);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const cellX = 2;
  const cellY = 2;
  const westId = lookup.vertical[cellX * (lookup.segmentsY + 1) + (cellY + 1)]!;
  const southId = lookup.horizontal[(cellX + 1) * (lookup.segmentsY + 1) + cellY]!;

  edgeActive[southId] = 0;

  assert.equal(
    severCellsWithSingleNeighbor(lookup, edgeActive, () => false),
    true,
  );
  assert.equal(edgeActive[westId], 0);
  assert.equal(edgeActive[southId], 0);
});

test('keeps single-link cells when attached to fixed vertices', () => {
  const { lookup, edgeCount } = makeStructuralLookup(3, 3);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const cellX = 0;
  const cellY = 1;
  const eastId = lookup.vertical[(cellX + 1) * (lookup.segmentsY + 1) + (cellY + 1)]!;
  const southId = lookup.horizontal[(cellX + 1) * (lookup.segmentsY + 1) + cellY]!;
  const northId = lookup.horizontal[(cellX + 1) * (lookup.segmentsY + 1) + (cellY + 1)]!;

  edgeActive[eastId] = 0;
  edgeActive[northId] = 0;

  assert.equal(
    severCellsWithSingleNeighbor(lookup, edgeActive, (gridX) => gridX === 0),
    false,
  );
  assert.equal(edgeActive[southId], 1);
});

test('assembly bend constraints depend on two-hop structural material paths', () => {
  const edges = [
    { id: 0, kind: 'structural' as const, vertex0: { id: 0, gridX: 0, gridY: 0 }, vertex1: { id: 1, gridX: 1, gridY: 0 } },
    { id: 1, kind: 'structural' as const, vertex0: { id: 1, gridX: 1, gridY: 0 }, vertex1: { id: 2, gridX: 2, gridY: 0 } },
    { id: 2, kind: 'bend' as const, vertex0: { id: 0, gridX: 0, gridY: 0 }, vertex1: { id: 2, gridX: 2, gridY: 0 } },
  ];
  const deps = buildEdgeStructuralDependencies(
    edges,
    createSimStructuralEdgeLookup(2, 0, new Array(3).fill(-1), new Array(3).fill(-1)),
  );

  const bendDeps = Array.from(deps.edgeDependencyIds.slice(deps.edgeDependencyStarts[2], deps.edgeDependencyStarts[3]));
  assert.deepEqual(bendDeps.sort(), [0, 1]);
});

test('collects strand thread edges for single-link interior cells', () => {
  const { lookup, edgeCount } = makeStructuralLookup(3, 3);
  const structural = makeStructuralGraphFromLookup(lookup);
  const vertexGrid = makeVertexGrid(lookup.segmentsX, lookup.segmentsY);
  const options = makeStrandOptions(lookup, vertexGrid);
  const edgeActive = new Uint32Array(edgeCount).fill(1);
  const eastId = lookup.vertical[2 * (lookup.segmentsY + 1) + 2]!;

  edgeActive[lookup.vertical[1 * (lookup.segmentsY + 1) + 2]!] = 0;
  edgeActive[lookup.horizontal[2 * (lookup.segmentsY + 1) + 1]!] = 0;
  edgeActive[lookup.horizontal[2 * (lookup.segmentsY + 1) + 2]!] = 0;

  const strandEdges = collectStrandThreadEdgeIds(
    structural,
    edgeActive,
    vertexGrid.length,
    () => false,
    options,
  );
  assert.ok(strandEdges.includes(eastId));
});

test('requires strand threads when no visible render triangle covers an active edge', () => {
  const { lookup, edgeCount } = makeStructuralLookup(1, 1);
  const structural = makeStructuralGraphFromLookup(lookup);
  const vertexGrid = makeVertexGrid(lookup.segmentsX, lookup.segmentsY);
  const options = makeStrandOptions(lookup, vertexGrid);
  const edgeActive = new Uint32Array(edgeCount).fill(0);
  const keepId = lookup.vertical[1 * (lookup.segmentsY + 1) + 1]!;
  edgeActive[keepId] = 1;

  const required = collectRequiredStrandThreadEdgeIds(structural, edgeActive, () => false, options);
  assert.deepEqual(required, [keepId]);
});

test('buildGpuParticleRenderSurface unshares corners for shader topology cull', () => {
  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 0]);
  const fabricUvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const baseIndices = new Uint32Array([0, 1, 2]);
  const triangleEdgeIds = new Int32Array([3, 4, -1]);

  const surface = buildGpuParticleRenderSurface(
    baseIndices,
    simGridCoords,
    fabricUvs,
    triangleEdgeIds,
  );

  assert.equal(surface.indices.length, 3);
  assert.deepEqual(surface.indices, new Uint32Array([0, 1, 2]));
  assert.equal(surface.simGridCoords.length / 2, 3);
  assert.equal(surface.particleTriEdge0[0], 3);
  assert.equal(surface.particleTriSimV2[2], 0);
  assert.equal(surface.renderSegmentId.length, 3);
  assert.deepEqual(surface.particleBary.slice(0, 9), new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
});

test('collectAssemblyStrandThreadEdgeIds requires uncovered active structural edges', () => {
  const simGridCoords = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
  ]);
  const baseIndices = new Uint32Array([0, 1, 2]);
  const triangleEdgeIds = new Int32Array([2, -1, 0]);
  const edgeActive = new Uint32Array([1, 1, 1]);
  edgeActive[2] = 0;
  const components = new Uint32Array([1, 1, 1]);
  const structural = [
    { id: 0, v0: 0, v1: 2 },
    { id: 1, v0: 1, v1: 2 },
    { id: 2, v0: 0, v1: 1 },
  ];

  const required = collectAssemblyStrandThreadEdgeIds(
    structural,
    edgeActive,
    () => false,
    { baseIndices, triangleEdgeIds, simGridCoordArray: simGridCoords, components },
  );

  assert.deepEqual(required.sort(), [0, 1]);
});

test('collectParticleRenderCoveredEdgeIds marks intact triangle edges', () => {
  const simGridCoords = new Float32Array([0, 0, 1, 0, 0, 1]);
  const baseIndices = new Uint32Array([0, 1, 2]);
  const triangleEdgeIds = new Int32Array([2, 1, 0]);
  const edgeActive = new Uint32Array([1, 1, 1]);
  const components = new Uint32Array([3, 3, 3]);

  const covered = collectParticleRenderCoveredEdgeIds(
    baseIndices,
    triangleEdgeIds,
    edgeActive,
    components,
    simGridCoords,
  );

  assert.deepEqual([...covered].sort(), [0, 1, 2]);
});

test('rebuildParticleRenderIndices drops triangles spanning disconnected components', () => {
  const simGridCoords = new Float32Array([
    0, 0,
    1, 0,
    0, 0,
    1, 0,
  ]);
  const baseIndices = new Uint32Array([0, 1, 2, 1, 3, 2]);
  const triangleEdgeIds = new Int32Array([-1, -1, -1, -1, -1, -1]);
  const edgeActive = new Uint32Array([1]);
  const components = new Uint32Array([10, 20, 10, 20]);

  const visible = rebuildParticleRenderIndices(
    baseIndices,
    simGridCoords,
    triangleEdgeIds,
    edgeActive,
    components,
  );

  assert.equal(visible.length, 0);
});

test('rebuildParticleRenderIndices keeps intact same-component triangles', () => {
  const simGridCoords = new Float32Array([
    0, 0,
    1, 0,
    0, 0,
  ]);
  const baseIndices = new Uint32Array([0, 1, 2]);
  const triangleEdgeIds = new Int32Array([-1, -1, -1]);
  const edgeActive = new Uint32Array([1]);
  const components = new Uint32Array([3, 3, 3]);

  const visible = rebuildParticleRenderIndices(
    baseIndices,
    simGridCoords,
    triangleEdgeIds,
    edgeActive,
    components,
  );

  assert.deepEqual(visible, baseIndices);
});

test('ignores outer rim bridges when collecting strand thread edges', () => {
  const { lookup, edgeCount } = makeStructuralLookup(3, 3);
  const structural = makeStructuralGraphFromLookup(lookup);
  const vertexGrid = makeVertexGrid(lookup.segmentsX, lookup.segmentsY);
  const options = makeStrandOptions(lookup, vertexGrid);
  const edgeActive = new Uint32Array(edgeCount).fill(1);

  const strandEdges = collectStrandThreadEdgeIds(
    structural,
    edgeActive,
    vertexGrid.length,
    () => false,
    options,
  );

  assert.equal(strandEdges.length, 0);
});
