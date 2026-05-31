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

export interface TShirtAssemblyOptions {
  readonly bodyWidth: number;
  readonly torsoHeight: number;
  readonly sleeveLength: number;
  readonly sleeveOpening: number;
  readonly sleeveTubeRadius?: number;
  readonly depth?: number;
  readonly bodySegmentsX?: number;
  readonly bodySegmentsY?: number;
  readonly sleeveSegmentsX?: number;
  readonly restLengthMode?: 'flat' | 'placed';
  readonly sleeveHangScale?: number;
  readonly sleeveLiftScale?: number;
  readonly sleeveVerticalRadiusScale?: number;
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

export function createTShirtAssembly(options: TShirtAssemblyOptions): ClothAssembly {
  const bodyWidth = options.bodyWidth;
  const torsoHeight = options.torsoHeight;
  const sleeveLength = options.sleeveLength;
  const depth = options.depth ?? 0.12;
  const halfDepth = depth * 0.5;
  const sleeveTubeRadius = options.sleeveTubeRadius ?? depth * 0.42;
  const placedSleeveHang = sleeveTubeRadius * (options.sleeveHangScale ?? 0.75);
  const placedSleeveLift = sleeveTubeRadius * (options.sleeveLiftScale ?? 0.62);
  const bodySegmentsX = Math.max(16, Math.round(options.bodySegmentsX ?? 24));
  const bodySegmentsY = Math.max(18, Math.round(options.bodySegmentsY ?? 28));
  const sleeveFlatCircumference = Math.PI * 2 * sleeveTubeRadius * 1.08;
  const sleeveSegmentsV = Math.min(
    bodySegmentsY,
    Math.max(8, Math.round((options.sleeveOpening / torsoHeight) * bodySegmentsY)),
  );
  const sleeveSegmentsX = Math.max(5, Math.round(options.sleeveSegmentsX ?? 8));
  const armholeTopV = bodySegmentsY;
  const armholeBottomV = bodySegmentsY - sleeveSegmentsV;
  const neckHalfSegments = Math.max(3, Math.round(bodySegmentsX * 0.16));
  const neckLeftEndU = Math.floor(bodySegmentsX * 0.5) - neckHalfSegments;
  const neckRightStartU = Math.ceil(bodySegmentsX * 0.5) + neckHalfSegments;
  const shoulderDrop = torsoHeight * 0.055;
  const frontNeckDrop = torsoHeight * 0.13;
  const backNeckDrop = torsoHeight * 0.045;
  const neckBindingWidth = torsoHeight * 0.025;

  const makeBody = (id: string, zSign: number, neckDrop: number, placed: boolean): ClothPatchDefinition => {
    const vertices: AssemblyVec3[] = [];
    const uvs: AssemblyVec2[] = [];
    const faces: [number, number, number][] = [];
    const idx = (u: number, v: number) => u * (bodySegmentsY + 1) + v;
    const rowWidth = (t: number): number => {
      const hemWidth = bodyWidth * 0.95;
      const shoulderWidth = bodyWidth * 0.84;
      if (t < 0.72) {
        return mix(hemWidth, bodyWidth, smoothstep(t / 0.72));
      }
      return mix(bodyWidth, shoulderWidth, smoothstep((t - 0.72) / 0.28));
    };
    const topY = (u: number): number => {
      const t = u / bodySegmentsX;
      const sideDrop = shoulderDrop * Math.abs(t * 2 - 1);
      let y = torsoHeight - sideDrop;
      if (u >= neckLeftEndU && u <= neckRightStartU) {
        const neckT = (u - neckLeftEndU) / (neckRightStartU - neckLeftEndU);
        y -= Math.sin(neckT * Math.PI) * neckDrop;
      }
      return y;
    };

    for (let u = 0; u <= bodySegmentsX; u++) {
      const tu = u / bodySegmentsX;
      const columnTop = topY(u);
      for (let v = 0; v <= bodySegmentsY; v++) {
        const tv = v / bodySegmentsY;
        const y = columnTop * tv;
        const x = (tu - 0.5) * rowWidth(tv);
        const centerBulge = Math.sin(tu * Math.PI) * (1 - smoothstep((tv - 0.9) / 0.1) * 0.1);
        const armholeT = armholeBottomV / bodySegmentsY;
        const armholeEdgeBulge = Math.pow(Math.abs(tu * 2 - 1), 4) * smoothstep((tv - armholeT) / 0.18);
        const z = placed ? zSign * halfDepth * Math.max(centerBulge, armholeEdgeBulge * 1.15) : 0;
        vertices.push([x, y, z]);
        uvs.push([tu, tv]);
      }
    }

    for (let u = 0; u < bodySegmentsX; u++) {
      for (let v = 0; v < bodySegmentsY; v++) {
        const i00 = idx(u, v);
        const i10 = idx(u + 1, v);
        const i01 = idx(u, v + 1);
        const i11 = idx(u + 1, v + 1);
        faces.push([i00, i10, i01], [i10, i11, i01]);
      }
    }

    return {
      id,
      label: id,
      vertices,
      uvs,
      faces,
      boundaries: {
        bottom: range(0, bodySegmentsX).map((u) => idx(u, 0)),
        right: range(0, bodySegmentsY).map((v) => idx(bodySegmentsX, v)),
        top: range(0, bodySegmentsX).map((u) => idx(u, bodySegmentsY)),
        left: range(0, bodySegmentsY).map((v) => idx(0, v)),
        leftLowerSide: range(0, armholeBottomV).map((v) => idx(0, v)),
        rightLowerSide: range(0, armholeBottomV).map((v) => idx(bodySegmentsX, v)),
        leftArmhole: range(armholeBottomV, armholeTopV).map((v) => idx(0, v)),
        rightArmhole: range(armholeBottomV, armholeTopV).map((v) => idx(bodySegmentsX, v)),
        leftShoulder: range(0, neckLeftEndU).map((u) => idx(u, bodySegmentsY)),
        rightShoulder: range(neckRightStartU, bodySegmentsX).map((u) => idx(u, bodySegmentsY)),
        neckline: range(neckLeftEndU, neckRightStartU).map((u) => idx(u, bodySegmentsY)),
      },
    };
  };

  const makeSleeve = (
    id: string,
    side: 'left' | 'right',
    frontArmhole: readonly AssemblyVec3[],
    backArmhole: readonly AssemblyVec3[],
    placed: boolean,
  ): ClothPatchDefinition => {
    const vertices: AssemblyVec3[] = [];
    const uvs: AssemblyVec2[] = [];
    const faces: [number, number, number][] = [];
    const halfRingSegments = frontArmhole.length - 1;
    const ringSegments = halfRingSegments * 2;
    const idx = (ring: number, length: number) => ring * (sleeveSegmentsX + 1) + length;
    const outward = side === 'left' ? -1 : 1;
    const centerY = frontArmhole.reduce((sum, position) => sum + position[1], 0) / frontArmhole.length;
    const lowY = Math.min(...frontArmhole.map((position) => position[1]));
    const highY = Math.max(...frontArmhole.map((position) => position[1]));
    const radiusY = Math.max(
      (highY - lowY) * (options.sleeveVerticalRadiusScale ?? 0.42),
      sleeveTubeRadius,
    );
    const radiusZ = sleeveTubeRadius;
    const innerX = frontArmhole[Math.floor(frontArmhole.length * 0.5)]![0];
    const outerX = innerX + outward * sleeveLength;
    const sleeveDrop = torsoHeight * 0.04;

    for (let ring = 0; ring <= ringSegments; ring++) {
      const ringT = ring / ringSegments;
      const inner = ring <= halfRingSegments
        ? frontArmhole[ring]!
        : backArmhole[ringSegments - ring]!;
      const angle = -Math.PI * 0.5 + ringT * Math.PI * 2;
      const cylinder: AssemblyVec3 = [
        outerX,
        centerY + placedSleeveLift + Math.sin(angle) * radiusY - sleeveDrop,
        Math.cos(angle) * radiusZ,
      ];
      for (let length = 0; length <= sleeveSegmentsX; length++) {
        const lengthT = length / sleeveSegmentsX;
        const sleeveHang = placedSleeveHang * smoothstep(lengthT);
        if (placed) {
          vertices.push([
            mix(inner[0], cylinder[0], lengthT),
            cylinder[1] - sleeveHang,
            cylinder[2],
          ]);
        } else {
          vertices.push([
            side === 'left' ? -sleeveLength * lengthT : sleeveLength * lengthT,
            centerY + (ringT - 0.5) * sleeveFlatCircumference,
            0,
          ]);
        }
        uvs.push([lengthT, ringT]);
      }
    }

    for (let ring = 0; ring < ringSegments; ring++) {
      for (let length = 0; length < sleeveSegmentsX; length++) {
        const i00 = idx(ring, length);
        const i10 = idx(ring + 1, length);
        const i01 = idx(ring, length + 1);
        const i11 = idx(ring + 1, length + 1);
        faces.push([i00, i10, i01], [i10, i11, i01]);
      }
    }

    return {
      id,
      label: id,
      vertices,
      uvs,
      faces,
      boundaries: {
        innerFrontHalf: range(0, halfRingSegments).map((ring) => idx(ring, 0)),
        innerBackHalf: range(0, halfRingSegments).map((ring) => idx(ringSegments - ring, 0)),
        cuff: range(0, ringSegments).map((ring) => idx(ring, sleeveSegmentsX)),
        seamStart: range(0, sleeveSegmentsX).map((length) => idx(0, length)),
        seamEnd: range(0, sleeveSegmentsX).map((length) => idx(ringSegments, length)),
      },
    };
  };

  const makeNeckBinding = (id: string, neckline: readonly AssemblyVec3[], placed: boolean): ClothPatchDefinition => {
    const vertices: AssemblyVec3[] = [];
    const uvs: AssemblyVec2[] = [];
    const faces: [number, number, number][] = [];
    const segmentsU = neckline.length - 1;
    const segmentsV = 2;
    const idx = (u: number, v: number) => u * (segmentsV + 1) + v;

    for (let u = 0; u <= segmentsU; u++) {
      const tu = u / segmentsU;
      const outer = neckline[u]!;
      const centerPull = (0.5 - tu) * neckBindingWidth * 0.28;
      for (let v = 0; v <= segmentsV; v++) {
        const tv = v / segmentsV;
        vertices.push([
          outer[0] + centerPull * tv,
          outer[1] - neckBindingWidth * tv,
          placed ? outer[2] : 0,
        ]);
        uvs.push([tu, tv]);
      }
    }

    for (let u = 0; u < segmentsU; u++) {
      for (let v = 0; v < segmentsV; v++) {
        const i00 = idx(u, v);
        const i10 = idx(u + 1, v);
        const i01 = idx(u, v + 1);
        const i11 = idx(u + 1, v + 1);
        faces.push([i00, i10, i01], [i10, i11, i01]);
      }
    }

    return {
      id,
      label: id,
      vertices,
      uvs,
      faces,
      boundaries: {
        outer: range(0, segmentsU).map((u) => idx(u, 0)),
        inner: range(0, segmentsU).map((u) => idx(u, segmentsV)),
        leftEnd: range(0, segmentsV).map((v) => idx(0, v)),
        rightEnd: range(0, segmentsV).map((v) => idx(segmentsU, v)),
      },
    };
  };

  const boundaryPositions = (patch: ClothPatchDefinition, name: BoundaryName): AssemblyVec3[] => {
    return patch.boundaries[name]!.map((id) => patch.vertices[id]!);
  };

  const buildShirtAssembly = (
    front: ClothPatchDefinition,
    back: ClothPatchDefinition,
    leftSleeve: ClothPatchDefinition,
    rightSleeve: ClothPatchDefinition,
    frontNeckBinding: ClothPatchDefinition,
    backNeckBinding: ClothPatchDefinition,
  ): ClothAssembly =>
    buildClothAssembly({
      patches: [
        front,
        back,
        leftSleeve,
        rightSleeve,
        frontNeckBinding,
        backNeckBinding,
      ],
      renderStitches: true,
      stitches: [
        stitch('tshirt-front-left-armhole', front.id, 'leftArmhole', leftSleeve.id, 'innerFrontHalf', false),
        stitch('tshirt-back-left-armhole', back.id, 'leftArmhole', leftSleeve.id, 'innerBackHalf', false),
        stitch('tshirt-front-right-armhole', front.id, 'rightArmhole', rightSleeve.id, 'innerFrontHalf', false),
        stitch('tshirt-back-right-armhole', back.id, 'rightArmhole', rightSleeve.id, 'innerBackHalf', false),
        stitch('tshirt-front-neck-binding', front.id, 'neckline', frontNeckBinding.id, 'outer', false),
        stitch('tshirt-back-neck-binding', back.id, 'neckline', backNeckBinding.id, 'outer', false),
        stitch('tshirt-left-side', front.id, 'leftLowerSide', back.id, 'leftLowerSide', false),
        stitch('tshirt-right-side', front.id, 'rightLowerSide', back.id, 'rightLowerSide', false),
        stitch('tshirt-left-shoulder', front.id, 'leftShoulder', back.id, 'leftShoulder', false),
        stitch('tshirt-right-shoulder', front.id, 'rightShoulder', back.id, 'rightShoulder', false),
        stitch('tshirt-left-sleeve-underarm', leftSleeve.id, 'seamStart', leftSleeve.id, 'seamEnd', false),
        stitch('tshirt-right-sleeve-underarm', rightSleeve.id, 'seamStart', rightSleeve.id, 'seamEnd', false),
        stitch('tshirt-neck-binding-left-join', frontNeckBinding.id, 'leftEnd', backNeckBinding.id, 'leftEnd', false),
        stitch('tshirt-neck-binding-right-join', frontNeckBinding.id, 'rightEnd', backNeckBinding.id, 'rightEnd', false),
      ],
    });

  const front = makeBody('tshirt-front', 1, frontNeckDrop, true);
  const back = makeBody('tshirt-back', -1, backNeckDrop, true);
  const leftSleeve = makeSleeve(
    'tshirt-left-sleeve',
    'left',
    boundaryPositions(front, 'leftArmhole'),
    boundaryPositions(back, 'leftArmhole'),
    true,
  );
  const rightSleeve = makeSleeve(
    'tshirt-right-sleeve',
    'right',
    boundaryPositions(front, 'rightArmhole'),
    boundaryPositions(back, 'rightArmhole'),
    true,
  );
  const frontNeckBinding = makeNeckBinding('tshirt-front-neck-binding', boundaryPositions(front, 'neckline'), true);
  const backNeckBinding = makeNeckBinding('tshirt-back-neck-binding', boundaryPositions(back, 'neckline'), true);
  const placed = buildShirtAssembly(front, back, leftSleeve, rightSleeve, frontNeckBinding, backNeckBinding);

  const flatFront = makeBody('tshirt-front', 1, frontNeckDrop, false);
  const flatBack = makeBody('tshirt-back', -1, backNeckDrop, false);
  const flatLeftSleeve = makeSleeve(
    'tshirt-left-sleeve',
    'left',
    boundaryPositions(flatFront, 'leftArmhole'),
    boundaryPositions(flatBack, 'leftArmhole'),
    false,
  );
  const flatRightSleeve = makeSleeve(
    'tshirt-right-sleeve',
    'right',
    boundaryPositions(flatFront, 'rightArmhole'),
    boundaryPositions(flatBack, 'rightArmhole'),
    false,
  );
  const flatFrontNeckBinding = makeNeckBinding(
    'tshirt-front-neck-binding',
    boundaryPositions(flatFront, 'neckline'),
    false,
  );
  const flatBackNeckBinding = makeNeckBinding(
    'tshirt-back-neck-binding',
    boundaryPositions(flatBack, 'neckline'),
    false,
  );
  const flat = buildShirtAssembly(
    flatFront,
    flatBack,
    flatLeftSleeve,
    flatRightSleeve,
    flatFrontNeckBinding,
    flatBackNeckBinding,
  );

  return options.restLengthMode === 'placed' ? placed : applyFlatRestLengthsToPlacedAssembly(flat, placed);
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

function applyFlatRestLengthsToPlacedAssembly(flat: ClothAssembly, placed: ClothAssembly): ClothAssembly {
  if (flat.edges.length !== placed.edges.length || flat.vertices.length !== placed.vertices.length) {
    throw new Error('Flat and placed T-shirt assemblies must share topology');
  }

  const edges = placed.edges.map((edge, index) => ({
    ...edge,
    restLength: flat.edges[index]!.restLength,
  }));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const stitchEdges = placed.stitchEdges.map((edge) => edgeById.get(edge.id)!);
  return {
    vertices: placed.vertices,
    faces: placed.faces,
    edges,
    stitchEdges,
  };
}

function stitch(
  id: string,
  panelA: string,
  edgeA: BoundaryName,
  panelB: string,
  edgeB: BoundaryName,
  reversed = false,
  restLength?: number,
): StitchDefinition {
  return {
    id,
    a: { patchId: panelA, boundary: edgeA },
    b: { patchId: panelB, boundary: edgeB, reversed },
    restLength,
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

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function distance(a: AssemblyVec3, b: AssemblyVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function range(start: number, endInclusive: number): number[] {
  return Array.from({ length: endInclusive - start + 1 }, (_, index) => start + index);
}
