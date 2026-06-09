import * as THREE from 'three/webgpu';
import { SEGMENT_COLOR_PATCH_KEYS } from '../cloth/clothMaterialBend.ts';
import type { ClothAssembly } from '../cloth/patternAssembly';

export type ClothTopologyKind = 'grid' | 'tube' | 'assembly';
export type ClothConstraintKind = 'structural' | 'shear' | 'bend' | 'stitch';
export type StitchWeldMode = 'weld' | 'constraints';

export interface ClothTopologyParticle {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly gridX: number;
  readonly gridY: number;
  readonly isFixed: boolean;
  /** Per-particle bend multiplier (assembly materials). */
  readonly bendScale: number;
  /** Per-particle dampening multiplier relative to the global dampening uniform. */
  readonly dampeningScale: number;
  /** Per-particle structural/shear stiffness multiplier. */
  readonly structuralScale: number;
  /** Per-particle compression resistance multiplier vs minCompression uniform. */
  readonly compressionScale: number;
  /** Per-particle tear strain multiplier vs global tearStretchThreshold uniform. */
  readonly tearThresholdScale: number;
  /** GPU segment id for multi-material strand/cloth shading. */
  readonly renderSegmentId: number;
}

export interface ClothTopologyConstraint {
  readonly a: number;
  readonly b: number;
  readonly kind: ClothConstraintKind;
  readonly restLength?: number;
}

export interface ClothTopologyRenderSurface {
  readonly source: 'grid' | 'particles';
  readonly simGridCoords?: Float32Array;
  readonly fabricUvs?: Float32Array;
  readonly indices?: number[];
  readonly renderVertexToParticle?: readonly number[];
  readonly renderSegmentIds?: Float32Array;
  readonly assembly?: ClothAssembly;
}

export interface ClothTopology {
  readonly kind: ClothTopologyKind;
  readonly particles: readonly ClothTopologyParticle[];
  readonly constraints: readonly ClothTopologyConstraint[];
  readonly columns: readonly (readonly number[])[];
  readonly segmentsX: number;
  readonly segmentsY: number;
  readonly horizontalEdgeIds: number[];
  readonly verticalEdgeIds: number[];
  readonly shearDownEdgeIds: number[];
  readonly shearUpEdgeIds: number[];
  readonly renderSurface: ClothTopologyRenderSurface;
  readonly selfCollisionExclusions: Uint32Array;
}

export interface GridClothTopologyOptions {
  readonly width: number;
  readonly height: number;
  readonly segmentsX: number;
  readonly segmentsY: number;
  readonly isolated: boolean;
  readonly pinMode: 'hoistCorners' | 'none';
  readonly initialShape: 'plane' | 'tube';
  readonly tubeRadius: number;
  readonly flagHoistTopY: number;
}

export function buildGridClothTopology(options: GridClothTopologyOptions): ClothTopology {
  const particles: ClothTopologyParticle[] = [];
  const constraints: ClothTopologyConstraint[] = [];
  const columns: number[][] = [];
  const kind: ClothTopologyKind = options.initialShape === 'tube' ? 'tube' : 'grid';

  const addParticle = (
    x: number,
    y: number,
    z: number,
    gridX: number,
    gridY: number,
    isFixed: boolean,
  ): number => {
    const id = particles.length;
    particles.push({
      id,
      position: new THREE.Vector3(x, y, z),
      gridX,
      gridY,
      isFixed,
      bendScale: 1,
      dampeningScale: 1,
      structuralScale: 1,
      compressionScale: 1,
      tearThresholdScale: 1,
      renderSegmentId: 0,
    });
    return id;
  };

  const addConstraint = (a: number, b: number, constraintKind: ClothConstraintKind): number => {
    const id = constraints.length;
    constraints.push({ a, b, kind: constraintKind });
    return id;
  };

  for (let x = 0; x <= options.segmentsX; x++) {
    const column: number[] = [];
    for (let y = 0; y <= options.segmentsY; y++) {
      const tubeColumns = options.segmentsX + 1;
      const u = options.initialShape === 'tube' ? x / tubeColumns : x / options.segmentsX;
      const posX = x * (options.width / options.segmentsX) - options.width * 0.5;
      const posY = options.isolated
        ? options.height * 0.5 - y * (options.height / options.segmentsY)
        : options.flagHoistTopY - y * (options.height / options.segmentsY);
      const angle = u * Math.PI * 2;
      const vertexX = options.initialShape === 'tube' ? Math.cos(angle) * options.tubeRadius : posX;
      const vertexZ = options.initialShape === 'tube' ? Math.sin(angle) * options.tubeRadius : 0;
      const isHoistCorner =
        options.pinMode === 'hoistCorners' && x === 0 && (y === 0 || y === options.segmentsY);
      column.push(addParticle(vertexX, posY, vertexZ, x, y, isHoistCorner));
    }
    columns.push(column);
  }

  const gridSizeY = options.segmentsY + 1;
  const lookupSize = (options.segmentsX + 1) * gridSizeY;
  const horizontalEdgeIds = new Array<number>(lookupSize).fill(-1);
  const verticalEdgeIds = new Array<number>(lookupSize).fill(-1);
  const shearDownEdgeIds = new Array<number>(lookupSize).fill(-1);
  const shearUpEdgeIds = new Array<number>(lookupSize).fill(-1);

  for (let x = 0; x <= options.segmentsX; x++) {
    for (let y = 0; y <= options.segmentsY; y++) {
      const vertex0 = columns[x]![y]!;
      if (x > 0) {
        horizontalEdgeIds[x * gridSizeY + y] = addConstraint(vertex0, columns[x - 1]![y]!, 'structural');
      }
      if (y > 0) {
        verticalEdgeIds[x * gridSizeY + y] = addConstraint(vertex0, columns[x]![y - 1]!, 'structural');
      }
      if (x > 0 && y > 0) {
        shearDownEdgeIds[x * gridSizeY + y] = addConstraint(vertex0, columns[x - 1]![y - 1]!, 'shear');
      }
      if (x > 0 && y < options.segmentsY) {
        shearUpEdgeIds[x * gridSizeY + y] = addConstraint(vertex0, columns[x - 1]![y + 1]!, 'shear');
      }
      if (x > 1) {
        addConstraint(vertex0, columns[x - 2]![y]!, 'bend');
      }
      if (y > 1) {
        addConstraint(vertex0, columns[x]![y - 2]!, 'bend');
      }
    }
  }

  if (options.initialShape === 'tube') {
    const firstColumn = columns[0]!;
    const seamColumn = columns[options.segmentsX]!;
    for (let y = 0; y <= options.segmentsY; y++) {
      addConstraint(seamColumn[y]!, firstColumn[y]!, 'structural');
      if (y > 0) {
        addConstraint(seamColumn[y]!, firstColumn[y - 1]!, 'shear');
      }
      if (y < options.segmentsY) {
        addConstraint(seamColumn[y]!, firstColumn[y + 1]!, 'shear');
      }
      if (y > 1) {
        addConstraint(seamColumn[y]!, firstColumn[y - 2]!, 'bend');
      }
    }
  }

  return {
    kind,
    particles,
    constraints,
    columns,
    segmentsX: options.segmentsX,
    segmentsY: options.segmentsY,
    horizontalEdgeIds,
    verticalEdgeIds,
    shearDownEdgeIds,
    shearUpEdgeIds,
    renderSurface: { source: 'grid' },
    selfCollisionExclusions: new Uint32Array(1),
  };
}

export interface AssemblyClothTopologyOptions {
  /** Pin particles whose merged dress vertices all lie at or above this world Y. */
  readonly pinVertexYAtOrAbove?: number;
  /** Pin particles on this Y (±1e-5) when any merged vertex patchId contains the substring. */
  readonly pinVertexYEqual?: number;
  readonly pinOnlyPatchIdContaining?: string;
  /** Scene dampening fallback when using absolute per-material dampening maps. */
  readonly globalDampening?: number;
  /** Scene bend stiffness fallback when using absolute per-material bend maps. */
  readonly globalBendStiffness?: number;
  /** Material-key → absolute bend stiffness; use with resolvePatchMaterialKey. */
  readonly materialBendStiffnessByKey?: Readonly<Record<string, number>>;
  /** Material-key → absolute velocity dampening; use with resolvePatchMaterialKey. */
  readonly materialDampeningByKey?: Readonly<Record<string, number>>;
  /** Material-key → structural/shear stiffness scale. */
  readonly materialStructuralScaleByKey?: Readonly<Record<string, number>>;
  /** Material-key → compression resistance scale. */
  readonly materialCompressionScaleByKey?: Readonly<Record<string, number>>;
  /** Scene-wide tear strain ratio used when a patch has no material override. */
  readonly globalTearStretchThreshold?: number;
  /** Material-key → absolute tear strain ratio (rest-length multiplier). */
  readonly materialTearThresholdByKey?: Readonly<Record<string, number>>;
  /** @deprecated Use {@link materialBendStiffnessByKey}. */
  readonly materialBendScaleByKey?: Readonly<Record<string, number>>;
  /** @deprecated Use {@link materialDampeningByKey}. */
  readonly materialDampeningScaleByKey?: Readonly<Record<string, number>>;
  /** @deprecated Use {@link materialTearThresholdByKey}. */
  readonly materialAbsoluteTearThresholdByKey?: Readonly<Record<string, number>>;
  /** Material-key → display color (RGB hex) for GPU segment shading. */
  readonly patchSegmentColorByKey?: Readonly<Record<string, string>>;
  readonly resolvePatchMaterialKey?: (patchId: string) => string;
  /**
   * weld: stitch vertices merge into one sim particle (character dressing default).
   * constraints: keep separate particles linked by stitch edges so tears can split patches.
   */
  readonly stitchWeldMode?: StitchWeldMode;
}

export function buildAssemblyClothTopology(
  assembly: ClothAssembly,
  options: AssemblyClothTopologyOptions = {},
): ClothTopology {
  const parent = new Uint32Array(assembly.vertices.length);
  for (let i = 0; i < parent.length; i++) {
    parent[i] = i;
  }

  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    while (parent[id] !== id) {
      const next = parent[id]!;
      parent[id] = root;
      id = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  };

  const stitchWeldMode = options.stitchWeldMode ?? 'weld';
  if (stitchWeldMode === 'weld') {
    for (const edge of assembly.stitchEdges) {
      if (edge.restLength <= 1e-6) {
        union(edge.a, edge.b);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (const vertex of assembly.vertices) {
    const root = find(vertex.id);
    const group = groups.get(root);
    if (group) {
      group.push(vertex.id);
    } else {
      groups.set(root, [vertex.id]);
    }
  }

  const particles: ClothTopologyParticle[] = [];
  const particleByRoot = new Map<number, number>();
  const renderVertexToParticle = new Array<number>(assembly.vertices.length).fill(0);

  for (const [root, vertexIds] of groups) {
    const average = new THREE.Vector3();
    for (const vertexId of vertexIds) {
      const vertex = assembly.vertices[vertexId]!;
      const position = vertex.position;
      average.add(new THREE.Vector3(position[0], position[1], position[2]));
    }
    average.multiplyScalar(1 / vertexIds.length);

    const pinYMin = options.pinVertexYAtOrAbove;
    const pinAtY = options.pinVertexYEqual;
    const pinPatchNeedle = options.pinOnlyPatchIdContaining;
    const shouldPin = (
      pinYMin !== undefined
      && vertexIds.every((vertexId) => assembly.vertices[vertexId]!.position[1] >= pinYMin - 1e-5)
    ) || (
      pinAtY !== undefined
      && pinPatchNeedle !== undefined
      && vertexIds.every((vertexId) => Math.abs(assembly.vertices[vertexId]!.position[1] - pinAtY) <= 1e-5)
      && vertexIds.some((vertexId) => assembly.vertices[vertexId]!.patchId.includes(pinPatchNeedle))
    );

    const absoluteBend = options.materialBendStiffnessByKey !== undefined;
    const absoluteDampening = options.materialDampeningByKey !== undefined;
    let bendScale = absoluteBend ? 0 : 1;
    let dampeningScale = absoluteDampening ? 0 : 1;
    let structuralScale = 1;
    let compressionScale = 1;
    let renderSegmentId = 0;
    const globalTear = options.globalTearStretchThreshold ?? 4;
    let tearThresholdScale = globalTear;
    let hasMaterialTear = false;
    const bendByKey = options.materialBendStiffnessByKey ?? options.materialBendScaleByKey;
    const dampeningByKey = options.materialDampeningByKey ?? options.materialDampeningScaleByKey;
    const structuralByKey = options.materialStructuralScaleByKey;
    const compressionByKey = options.materialCompressionScaleByKey;
    const tearByKey = options.materialTearThresholdByKey ?? options.materialAbsoluteTearThresholdByKey;
    const resolveKey = options.resolvePatchMaterialKey;
    const segmentColors = options.patchSegmentColorByKey;
    const keyToSegmentId = segmentColors && resolveKey
      ? new Map(
          SEGMENT_COLOR_PATCH_KEYS
            .filter((key) => segmentColors[key] !== undefined)
            .map((key, index) => [key, index]),
        )
      : null;
    if (resolveKey) {
      for (const vertexId of vertexIds) {
        const patchId = assembly.vertices[vertexId]!.patchId;
        const key = resolveKey(patchId);
        if (keyToSegmentId) {
          renderSegmentId = Math.max(renderSegmentId, keyToSegmentId.get(key) ?? 0);
        }
        if (bendByKey) {
          const bendValue = bendByKey[key];
          if (bendValue !== undefined) {
            bendScale = absoluteBend
              ? Math.max(bendScale, bendValue)
              : Math.max(bendScale, bendValue);
          } else if (!absoluteBend) {
            bendScale = Math.max(bendScale, 1);
          }
        }
        if (dampeningByKey) {
          const dampeningValue = dampeningByKey[key];
          if (dampeningValue !== undefined) {
            dampeningScale = absoluteDampening
              ? Math.max(dampeningScale, dampeningValue)
              : Math.max(dampeningScale, dampeningValue);
          } else if (!absoluteDampening) {
            dampeningScale = Math.max(dampeningScale, 1);
          }
        }
        if (structuralByKey) {
          structuralScale = Math.max(structuralScale, structuralByKey[key] ?? 1);
        }
        if (compressionByKey) {
          compressionScale = Math.max(compressionScale, compressionByKey[key] ?? 1);
        }
        const materialTear = tearByKey?.[key];
        if (materialTear !== undefined) {
          tearThresholdScale = hasMaterialTear
            ? Math.min(tearThresholdScale, materialTear)
            : materialTear;
          hasMaterialTear = true;
        }
      }
    }

    if (absoluteBend && bendScale <= 0) {
      bendScale = options.globalBendStiffness ?? 0.01;
    }
    if (absoluteDampening && dampeningScale <= 0) {
      dampeningScale = options.globalDampening ?? 0.9925;
    }

    const id = particles.length;
    particles.push({
      id,
      position: average,
      gridX: id,
      gridY: 0,
      isFixed: shouldPin,
      bendScale,
      dampeningScale,
      structuralScale,
      compressionScale,
      tearThresholdScale,
      renderSegmentId,
    });
    particleByRoot.set(root, id);
    for (const vertexId of vertexIds) {
      renderVertexToParticle[vertexId] = id;
    }
  }

  const constraints: ClothTopologyConstraint[] = [];
  const edgeKeys = new Set<string>();
  const addConstraint = (
    a: number,
    b: number,
    kind: ClothConstraintKind,
    restLength?: number,
  ): void => {
    if (a === b) {
      return;
    }
    const key = a < b ? `${a}:${b}:${kind}` : `${b}:${a}:${kind}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    constraints.push({ a, b, kind, restLength });
  };

  for (const edge of assembly.edges) {
    if (edge.kind === 'stitch') {
      continue;
    }
    const a = particleByRoot.get(find(edge.a));
    const b = particleByRoot.get(find(edge.b));
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    const constraintKind: ClothConstraintKind = edge.kind === 'shear' ? 'shear' : 'structural';
    addConstraint(a, b, constraintKind, edge.restLength);
  }

  addFaceBendConstraints(assembly, renderVertexToParticle, addConstraint);

  if (stitchWeldMode === 'constraints') {
    for (const stitchEdge of assembly.stitchEdges) {
      const a = renderVertexToParticle[stitchEdge.a];
      const b = renderVertexToParticle[stitchEdge.b];
      if (a === undefined || b === undefined) {
        continue;
      }
      const particleA = particles[a]!;
      const particleB = particles[b]!;
      const dressRest = particleA.position.distanceTo(particleB.position);
      const stitchRest =
        stitchEdge.restLength > 1e-6 ? stitchEdge.restLength : Math.max(dressRest, 1e-5);
      addConstraint(a, b, 'stitch', stitchRest);
    }
  }

  const segmentsX = Math.max(1, particles.length - 1);
  const lookupSize = particles.length;
  const columns = particles.map((particle) => [particle.id]);
  const simGridCoords = new Float32Array(assembly.vertices.length * 2);
  const fabricUvs = new Float32Array(assembly.vertices.length * 2);
  const indices: number[] = [];

  for (const vertex of assembly.vertices) {
    simGridCoords[vertex.id * 2] = renderVertexToParticle[vertex.id]!;
    simGridCoords[vertex.id * 2 + 1] = 0;
    fabricUvs[vertex.id * 2] = vertex.uv[0];
    fabricUvs[vertex.id * 2 + 1] = vertex.uv[1];
  }

  for (const face of assembly.faces) {
    indices.push(...face.vertices);
  }

  let renderSegmentIds: Float32Array | undefined;
  const segmentColors = options.patchSegmentColorByKey;
  const resolvePatchKey = options.resolvePatchMaterialKey;
  if (segmentColors && resolvePatchKey) {
    const keyToSegmentId = new Map(
      SEGMENT_COLOR_PATCH_KEYS
        .filter((key) => segmentColors[key] !== undefined)
        .map((key, index) => [key, index]),
    );
    renderSegmentIds = new Float32Array(assembly.vertices.length);
    for (const vertex of assembly.vertices) {
      const key = resolvePatchKey(vertex.patchId);
      renderSegmentIds[vertex.id] = keyToSegmentId.get(key) ?? 0;
    }
  }

  return {
    kind: 'assembly',
    particles,
    constraints,
    columns,
    segmentsX,
    segmentsY: 0,
    horizontalEdgeIds: new Array<number>(lookupSize).fill(-1),
    verticalEdgeIds: new Array<number>(lookupSize).fill(-1),
    shearDownEdgeIds: new Array<number>(lookupSize).fill(-1),
    shearUpEdgeIds: new Array<number>(lookupSize).fill(-1),
    renderSurface: {
      source: 'particles',
      simGridCoords,
      fabricUvs,
      indices,
      renderVertexToParticle,
      renderSegmentIds,
      assembly,
    },
    selfCollisionExclusions: buildAssemblySelfCollisionExclusions(constraints, particles.length),
  };
}

const MAX_SELF_COLLISION_EXCLUSION_BYTES = 48 * 1024 * 1024;

/** Immediate structural/shear neighbors only — cross-patch pairs stay collidable. */
export function buildAssemblySelfCollisionExclusions(
  constraints: readonly ClothTopologyConstraint[],
  vertexCount: number,
): Uint32Array {
  const surfaceConstraints = constraints.filter(
    (constraint) => constraint.kind === 'structural' || constraint.kind === 'shear',
  );
  return buildSelfCollisionExclusionsForTopology(vertexCount, surfaceConstraints, 1);
}

function buildSelfCollisionExclusionsForTopology(
  vertexCount: number,
  constraints: readonly ClothTopologyConstraint[],
  maxDepth: number,
): Uint32Array {
  if (vertexCount * vertexCount * 4 > MAX_SELF_COLLISION_EXCLUSION_BYTES) {
    return new Uint32Array(1);
  }
  return buildGraphDistanceExclusions(vertexCount, constraints, maxDepth);
}

function addFaceBendConstraints(
  assembly: ClothAssembly,
  renderVertexToParticle: readonly number[],
  addConstraint: (a: number, b: number, kind: ClothConstraintKind, restLength?: number) => void,
): void {
  const neighbors = new Map<number, Set<number>>();
  for (const face of assembly.faces) {
    if (face.source !== 'patch') {
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const a = renderVertexToParticle[face.vertices[i]!]!;
      const b = renderVertexToParticle[face.vertices[(i + 1) % 3]!]!;
      if (a === b) {
        continue;
      }
      if (!neighbors.has(a)) {
        neighbors.set(a, new Set());
      }
      if (!neighbors.has(b)) {
        neighbors.set(b, new Set());
      }
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }
  }

  for (const [center, directNeighbors] of neighbors) {
    for (const neighbor of directNeighbors) {
      const nextNeighbors = neighbors.get(neighbor);
      if (!nextNeighbors) {
        continue;
      }
      for (const twoHop of nextNeighbors) {
        if (twoHop !== center && !directNeighbors.has(twoHop)) {
          addConstraint(center, twoHop, 'bend');
        }
      }
    }
  }
}

function buildGraphDistanceExclusions(
  vertexCount: number,
  constraints: readonly ClothTopologyConstraint[],
  maxDepth: number,
): Uint32Array {
  const exclusions = new Uint32Array(vertexCount * vertexCount);
  const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);

  for (const constraint of constraints) {
    adjacency[constraint.a]!.push(constraint.b);
    adjacency[constraint.b]!.push(constraint.a);
  }

  for (let source = 0; source < vertexCount; source++) {
    const queue: Array<{ id: number; depth: number }> = [{ id: source, depth: 0 }];
    const visited = new Set<number>([source]);
    exclusions[source * vertexCount + source] = 1;

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { id, depth } = queue[cursor]!;
      if (depth >= maxDepth) {
        continue;
      }

      for (const next of adjacency[id]!) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        exclusions[source * vertexCount + next] = 1;
        queue.push({ id: next, depth: depth + 1 });
      }
    }
  }

  return exclusions;
}
