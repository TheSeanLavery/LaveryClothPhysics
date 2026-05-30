export type AssemblyVec2 = readonly [number, number];
export type AssemblyVec3 = readonly [number, number, number];
export type BoundaryName = 'bottom' | 'right' | 'top' | 'left' | string;

export interface ClothPatchDefinition {
  readonly id: string;
  readonly label?: string;
  readonly vertices: readonly AssemblyVec3[];
  readonly uvs?: readonly AssemblyVec2[];
  readonly faces: readonly (readonly [number, number, number])[];
  readonly boundaries: Readonly<Record<BoundaryName, readonly number[]>>;
}

export interface StitchEndpoint {
  readonly patchId: string;
  readonly boundary: BoundaryName;
  readonly reversed?: boolean;
}

export interface StitchDefinition {
  readonly id: string;
  readonly a: StitchEndpoint;
  readonly b: StitchEndpoint;
  /**
   * Weld stitches default to rest length 0. Later solver integration should
   * handle these separately from structural cloth edges.
   */
  readonly restLength?: number;
  readonly renderFaces?: boolean;
}

export interface AssemblyVertex {
  readonly id: number;
  readonly patchId: string;
  readonly localId: number;
  readonly position: AssemblyVec3;
  readonly uv: AssemblyVec2;
}

export interface AssemblyFace {
  readonly id: number;
  readonly vertices: readonly [number, number, number];
  readonly source: 'patch' | 'stitch-render';
  readonly stitchId?: string;
}

export interface AssemblyEdge {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly kind: 'structural' | 'stitch';
  readonly restLength: number;
  readonly sourceId: string;
}

export interface ClothAssembly {
  readonly vertices: readonly AssemblyVertex[];
  readonly faces: readonly AssemblyFace[];
  readonly edges: readonly AssemblyEdge[];
  readonly stitchEdges: readonly AssemblyEdge[];
}

export interface QuadPatchOptions {
  readonly id: string;
  readonly label?: string;
  /** Corners in bottom-left, bottom-right, top-right, top-left order. */
  readonly corners: readonly [AssemblyVec3, AssemblyVec3, AssemblyVec3, AssemblyVec3];
  readonly segmentsU?: number;
  readonly segmentsV?: number;
}

export interface TrianglePatchOptions {
  readonly id: string;
  readonly label?: string;
  /** Corners in base-left, base-right, apex order. */
  readonly corners: readonly [AssemblyVec3, AssemblyVec3, AssemblyVec3];
}

export interface ClothAssemblyOptions {
  readonly patches: readonly ClothPatchDefinition[];
  readonly stitches?: readonly StitchDefinition[];
  readonly renderStitches?: boolean;
}

export interface BoxAssemblyOptions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly segments?: number;
}

export interface OctagonalTubeAssemblyOptions {
  readonly radius: number;
  readonly height: number;
  readonly segmentsAround?: number;
  readonly segmentsHeight?: number;
}

export interface PyramidAssemblyOptions {
  readonly baseSize: number;
  readonly height: number;
  readonly includeBase?: boolean;
}

export interface AssemblyValidationIssue {
  readonly id: string;
  readonly message: string;
}

export function createQuadPatch(options: QuadPatchOptions): ClothPatchDefinition {
  const segmentsU = Math.max(1, Math.round(options.segmentsU ?? 1));
  const segmentsV = Math.max(1, Math.round(options.segmentsV ?? 1));
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const index = (u: number, v: number) => u * (segmentsV + 1) + v;

  for (let u = 0; u <= segmentsU; u++) {
    const tu = u / segmentsU;
    for (let v = 0; v <= segmentsV; v++) {
      const tv = v / segmentsV;
      vertices.push(bilinear(options.corners, tu, tv));
      uvs.push([tu, tv]);
    }
  }

  for (let u = 0; u < segmentsU; u++) {
    for (let v = 0; v < segmentsV; v++) {
      const i00 = index(u, v);
      const i10 = index(u + 1, v);
      const i01 = index(u, v + 1);
      const i11 = index(u + 1, v + 1);
      faces.push([i00, i10, i01], [i10, i11, i01]);
    }
  }

  return {
    id: options.id,
    label: options.label ?? options.id,
    vertices,
    uvs,
    faces,
    boundaries: {
      bottom: range(0, segmentsU).map((u) => index(u, 0)),
      right: range(0, segmentsV).map((v) => index(segmentsU, v)),
      top: range(0, segmentsU).map((u) => index(u, segmentsV)),
      left: range(0, segmentsV).map((v) => index(0, v)),
    },
  };
}

export function createTrianglePatch(options: TrianglePatchOptions): ClothPatchDefinition {
  return {
    id: options.id,
    label: options.label ?? options.id,
    vertices: options.corners,
    uvs: [[0, 0], [1, 0], [0.5, 1]],
    faces: [[0, 1, 2]],
    boundaries: {
      bottom: [0, 1],
      right: [1, 2],
      left: [0, 2],
    },
  };
}

export function buildClothAssembly(options: ClothAssemblyOptions): ClothAssembly {
  const vertices: AssemblyVertex[] = [];
  const faces: AssemblyFace[] = [];
  const edges: AssemblyEdge[] = [];
  const stitchEdges: AssemblyEdge[] = [];
  const patchOffsets = new Map<string, number>();
  const patchById = new Map<string, ClothPatchDefinition>();
  const structuralEdgeKeys = new Set<string>();

  for (const patch of options.patches) {
    if (patchById.has(patch.id)) {
      throw new Error(`Duplicate patch id "${patch.id}"`);
    }
    patchById.set(patch.id, patch);
    patchOffsets.set(patch.id, vertices.length);

    for (let localId = 0; localId < patch.vertices.length; localId++) {
      vertices.push({
        id: vertices.length,
        patchId: patch.id,
        localId,
        position: patch.vertices[localId]!,
        uv: patch.uvs?.[localId] ?? [0, 0],
      });
    }

    for (const face of patch.faces) {
      const globalFace = face.map((localId) => patchOffsets.get(patch.id)! + localId) as [
        number,
        number,
        number,
      ];
      faces.push({ id: faces.length, vertices: globalFace, source: 'patch' });
      addStructuralEdge(edges, structuralEdgeKeys, vertices, globalFace[0], globalFace[1], patch.id);
      addStructuralEdge(edges, structuralEdgeKeys, vertices, globalFace[1], globalFace[2], patch.id);
      addStructuralEdge(edges, structuralEdgeKeys, vertices, globalFace[2], globalFace[0], patch.id);
    }
  }

  for (const stitch of options.stitches ?? []) {
    const a = resolveBoundary(stitch.a, patchById, patchOffsets);
    const b = resolveBoundary(stitch.b, patchById, patchOffsets);
    if (a.length !== b.length) {
      throw new Error(`Stitch "${stitch.id}" boundary counts differ (${a.length} vs ${b.length})`);
    }

    for (let i = 0; i < a.length; i++) {
      const edge: AssemblyEdge = {
        id: edges.length,
        a: a[i]!,
        b: b[i]!,
        kind: 'stitch',
        restLength: stitch.restLength ?? 0,
        sourceId: stitch.id,
      };
      edges.push(edge);
      stitchEdges.push(edge);
    }

    if (stitch.renderFaces ?? options.renderStitches) {
      addStitchRenderFaces(faces, stitch.id, a, b);
    }
  }

  return { vertices, faces, edges, stitchEdges };
}

export function validateClothAssembly(assembly: ClothAssembly): AssemblyValidationIssue[] {
  const issues: AssemblyValidationIssue[] = [];
  for (const vertex of assembly.vertices) {
    if (!vertex.position.every(Number.isFinite)) {
      issues.push({ id: `vertex-${vertex.id}`, message: 'Vertex contains a non-finite position' });
    }
  }
  for (const edge of assembly.edges) {
    if (edge.a === edge.b) {
      issues.push({ id: `edge-${edge.id}`, message: 'Edge connects a vertex to itself' });
    }
  }
  return issues;
}

export function createStitchedBoxAssembly(options: BoxAssemblyOptions): ClothAssembly {
  const { width, height, depth } = options;
  const sx = Math.max(1, Math.round(options.segments ?? 1));
  const hw = width * 0.5;
  const hh = height * 0.5;
  const hd = depth * 0.5;

  const patches = [
    createQuadPatch({ id: 'front', corners: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]], segmentsU: sx, segmentsV: sx }),
    createQuadPatch({ id: 'back', corners: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]], segmentsU: sx, segmentsV: sx }),
    createQuadPatch({ id: 'left', corners: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]], segmentsU: sx, segmentsV: sx }),
    createQuadPatch({ id: 'right', corners: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]], segmentsU: sx, segmentsV: sx }),
    createQuadPatch({ id: 'top', corners: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]], segmentsU: sx, segmentsV: sx }),
    createQuadPatch({ id: 'bottom', corners: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]], segmentsU: sx, segmentsV: sx }),
  ];

  return buildClothAssembly({
    patches,
    renderStitches: true,
    stitches: [
      stitch('front-left', 'front', 'left', 'left', 'right', false),
      stitch('front-right', 'front', 'right', 'right', 'left', false),
      stitch('front-top', 'front', 'top', 'top', 'bottom', false),
      stitch('front-bottom', 'front', 'bottom', 'bottom', 'top', false),
      stitch('back-left', 'back', 'left', 'right', 'right', false),
      stitch('back-right', 'back', 'right', 'left', 'left', false),
      stitch('back-top', 'back', 'top', 'top', 'top', true),
      stitch('back-bottom', 'back', 'bottom', 'bottom', 'bottom', true),
      stitch('left-top', 'left', 'top', 'top', 'left', true),
      stitch('left-bottom', 'left', 'bottom', 'bottom', 'left', false),
      stitch('right-top', 'right', 'top', 'top', 'right', false),
      stitch('right-bottom', 'right', 'bottom', 'bottom', 'right', true),
    ],
  });
}

export function createOctagonalTubeAssembly(options: OctagonalTubeAssemblyOptions): ClothAssembly {
  const panelCount = 8;
  const segmentsAround = Math.max(1, Math.round(options.segmentsAround ?? 1));
  const segmentsHeight = Math.max(1, Math.round(options.segmentsHeight ?? 4));
  const patches: ClothPatchDefinition[] = [];
  const stitches: StitchDefinition[] = [];
  const halfHeight = options.height * 0.5;

  for (let i = 0; i < panelCount; i++) {
    const a0 = (i / panelCount) * Math.PI * 2;
    const a1 = ((i + 1) / panelCount) * Math.PI * 2;
    patches.push(
      createQuadPatch({
        id: `oct-panel-${i}`,
        corners: [
          [Math.cos(a0) * options.radius, -halfHeight, Math.sin(a0) * options.radius],
          [Math.cos(a1) * options.radius, -halfHeight, Math.sin(a1) * options.radius],
          [Math.cos(a1) * options.radius, halfHeight, Math.sin(a1) * options.radius],
          [Math.cos(a0) * options.radius, halfHeight, Math.sin(a0) * options.radius],
        ],
        segmentsU: segmentsAround,
        segmentsV: segmentsHeight,
      }),
    );
  }

  for (let i = 0; i < panelCount; i++) {
    stitches.push(stitch(`oct-seam-${i}`, `oct-panel-${i}`, 'right', `oct-panel-${(i + 1) % panelCount}`, 'left', false));
  }

  return buildClothAssembly({ patches, stitches, renderStitches: true });
}

export function createPyramidAssembly(options: PyramidAssemblyOptions): ClothAssembly {
  const h = options.baseSize * 0.5;
  const apex: AssemblyVec3 = [0, options.height, 0];
  const corners: AssemblyVec3[] = [[-h, 0, h], [h, 0, h], [h, 0, -h], [-h, 0, -h]];
  const patches: ClothPatchDefinition[] = [
    createTrianglePatch({ id: 'pyramid-front', corners: [corners[0]!, corners[1]!, apex] }),
    createTrianglePatch({ id: 'pyramid-right', corners: [corners[1]!, corners[2]!, apex] }),
    createTrianglePatch({ id: 'pyramid-back', corners: [corners[2]!, corners[3]!, apex] }),
    createTrianglePatch({ id: 'pyramid-left', corners: [corners[3]!, corners[0]!, apex] }),
  ];
  const stitches: StitchDefinition[] = [
    stitch('pyramid-front-right', 'pyramid-front', 'right', 'pyramid-right', 'left', false),
    stitch('pyramid-right-back', 'pyramid-right', 'right', 'pyramid-back', 'left', false),
    stitch('pyramid-back-left', 'pyramid-back', 'right', 'pyramid-left', 'left', false),
    stitch('pyramid-left-front', 'pyramid-left', 'right', 'pyramid-front', 'left', false),
  ];

  if (options.includeBase ?? true) {
    patches.push(
      createQuadPatch({
        id: 'pyramid-base',
        corners: [corners[3]!, corners[2]!, corners[1]!, corners[0]!],
      }),
    );
    stitches.push(
      stitch('pyramid-base-front', 'pyramid-front', 'bottom', 'pyramid-base', 'top', false),
      stitch('pyramid-base-right', 'pyramid-right', 'bottom', 'pyramid-base', 'right', true),
      stitch('pyramid-base-back', 'pyramid-back', 'bottom', 'pyramid-base', 'bottom', true),
      stitch('pyramid-base-left', 'pyramid-left', 'bottom', 'pyramid-base', 'left', false),
    );
  }

  return buildClothAssembly({ patches, stitches, renderStitches: true });
}

function addStructuralEdge(
  edges: AssemblyEdge[],
  edgeKeys: Set<string>,
  vertices: AssemblyVertex[],
  a: number,
  b: number,
  sourceId: string,
): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (edgeKeys.has(key)) {
    return;
  }
  edgeKeys.add(key);
  edges.push({
    id: edges.length,
    a,
    b,
    kind: 'structural',
    restLength: distance(vertices[a]!.position, vertices[b]!.position),
    sourceId,
  });
}

function addStitchRenderFaces(
  faces: AssemblyFace[],
  stitchId: string,
  a: readonly number[],
  b: readonly number[],
): void {
  for (let i = 0; i < a.length - 1; i++) {
    faces.push({ id: faces.length, vertices: [a[i]!, b[i]!, a[i + 1]!], source: 'stitch-render', stitchId });
    faces.push({ id: faces.length, vertices: [b[i]!, b[i + 1]!, a[i + 1]!], source: 'stitch-render', stitchId });
  }
}

function resolveBoundary(
  endpoint: StitchEndpoint,
  patchById: ReadonlyMap<string, ClothPatchDefinition>,
  patchOffsets: ReadonlyMap<string, number>,
): number[] {
  const patch = patchById.get(endpoint.patchId);
  if (!patch) {
    throw new Error(`Unknown patch "${endpoint.patchId}"`);
  }
  const localBoundary = patch.boundaries[endpoint.boundary];
  if (!localBoundary) {
    throw new Error(`Unknown boundary "${endpoint.boundary}" on patch "${endpoint.patchId}"`);
  }
  const offset = patchOffsets.get(endpoint.patchId)!;
  const ids = localBoundary.map((localId) => offset + localId);
  return endpoint.reversed ? ids.reverse() : ids;
}

function stitch(
  id: string,
  panelA: string,
  edgeA: BoundaryName,
  panelB: string,
  edgeB: BoundaryName,
  reversed = false,
): StitchDefinition {
  return {
    id,
    a: { patchId: panelA, boundary: edgeA },
    b: { patchId: panelB, boundary: edgeB, reversed },
  };
}

function bilinear(
  corners: readonly [AssemblyVec3, AssemblyVec3, AssemblyVec3, AssemblyVec3],
  u: number,
  v: number,
): AssemblyVec3 {
  const bottom = mix3(corners[0], corners[1], u);
  const top = mix3(corners[3], corners[2], u);
  return mix3(bottom, top, v);
}

function mix3(a: AssemblyVec3, b: AssemblyVec3, t: number): AssemblyVec3 {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ];
}

function distance(a: AssemblyVec3, b: AssemblyVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function range(start: number, endInclusive: number): number[] {
  return Array.from({ length: endInclusive - start + 1 }, (_, index) => start + index);
}
