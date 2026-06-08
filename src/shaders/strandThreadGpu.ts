import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  abs,
  attribute,
  cross,
  float,
  instanceIndex,
  select,
  uint,
  vec3,
  varyingProperty,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

type UintBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

type Vec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<THREE.Vector3>;
};

type FloatBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

type Uvec2Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<{
    x: ShaderNodeObject<number>;
    y: ShaderNodeObject<number>;
  }>;
};

type Uvec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<{
    x: ShaderNodeObject<number>;
    y: ShaderNodeObject<number>;
    z: ShaderNodeObject<number>;
  }>;
};

export interface StrandThreadGpuComputeOptions {
  edgeCount: number;
  dressTriangleCount: number;
  edgeVisualBuffer: UintBuffer;
  edgeKindBuffer: UintBuffer;
  edgeCoveredBuffer: UintBuffer;
  strandEdgeVisibleBuffer: UintBuffer;
  vertexComponentBuffer: UintBuffer;
  vertexParamsBuffer: Uvec3Buffer;
  vertexPositionBuffer: Vec3Buffer;
  springVertexIdBuffer: Uvec2Buffer;
  springRestLengthBuffer: FloatBuffer;
  dressTriEdge0Buffer: UintBuffer;
  dressTriEdge1Buffer: UintBuffer;
  dressTriEdge2Buffer: UintBuffer;
  dressTriSimV0Buffer: UintBuffer;
  dressTriSimV1Buffer: UintBuffer;
  dressTriSimV2Buffer: UintBuffer;
  dressTriRenderableBuffer: UintBuffer;
}

export interface StrandThreadGpuComputePasses {
  updateDressTriRenderable: ReturnType<ReturnType<typeof Fn>['compute']>;
  clearEdgeCovered: ReturnType<ReturnType<typeof Fn>['compute']>;
  markEdgeCovered: ReturnType<ReturnType<typeof Fn>['compute']>;
  clearTornAdjacencyCoverage: ReturnType<ReturnType<typeof Fn>['compute']>;
  clearSpanGapCoverage: ReturnType<ReturnType<typeof Fn>['compute']>;
  updateStrandVisibility: ReturnType<ReturnType<typeof Fn>['compute']>;
}

const invalidEdgeId = uint(0xffffffff);
/** Active edges stretched past rest length still need threads across SDF tear gaps. */
/** Ignore light wind/grab stretch; torn bridge links are typically well above 1.2× rest. */
const strandSpanGapRatio = float(1.05);

export function createStrandThreadGpuCompute(
  options: StrandThreadGpuComputeOptions,
): StrandThreadGpuComputePasses {
  const {
    edgeCount,
    dressTriangleCount,
    edgeVisualBuffer,
    edgeKindBuffer,
    edgeCoveredBuffer,
    strandEdgeVisibleBuffer,
    vertexComponentBuffer,
    vertexParamsBuffer,
    vertexPositionBuffer,
    springVertexIdBuffer,
    springRestLengthBuffer,
    dressTriEdge0Buffer,
    dressTriEdge1Buffer,
    dressTriEdge2Buffer,
    dressTriSimV0Buffer,
    dressTriSimV1Buffer,
    dressTriSimV2Buffer,
    dressTriRenderableBuffer,
  } = options;

  const edgeCountUint = uint(edgeCount);
  const dressTriangleCountUint = uint(dressTriangleCount);

  const isEdgeBroken = Fn(([edgeIdScalar]) => {
    const edgeId = uint(edgeIdScalar);
    return edgeIdScalar
      .greaterThanEqual(float(0))
      .and(edgeVisualBuffer.element(edgeId).equal(uint(0)));
  });

  const updateDressTriRenderable = Fn(() => {
    If(instanceIndex.greaterThanEqual(dressTriangleCountUint), () => {
      Return();
    });

    const tri = uint(instanceIndex);
    const simV0 = dressTriSimV0Buffer.element(tri);
    const simV1 = dressTriSimV1Buffer.element(tri);
    const simV2 = dressTriSimV2Buffer.element(tri);
    const sameComponent = vertexComponentBuffer
      .element(simV0)
      .equal(vertexComponentBuffer.element(simV1))
      .and(vertexComponentBuffer.element(simV0).equal(vertexComponentBuffer.element(simV2)));
    const e0 = dressTriEdge0Buffer.element(tri);
    const e1 = dressTriEdge1Buffer.element(tri);
    const e2 = dressTriEdge2Buffer.element(tri);
    const valid0 = e0.notEqual(invalidEdgeId);
    const valid1 = e1.notEqual(invalidEdgeId);
    const valid2 = e2.notEqual(invalidEdgeId);
    const broken0 = valid0.and(isEdgeBroken(e0));
    const broken1 = valid1.and(isEdgeBroken(e1));
    const broken2 = valid2.and(isEdgeBroken(e2));
    const renderable = sameComponent.and(broken0.or(broken1).or(broken2).not());

    dressTriRenderableBuffer.element(tri).assign(select(renderable, uint(1), uint(0)));
  })()
    .compute(Math.max(dressTriangleCount, 1))
    .setName('Update Strand Dress Tri Renderable');

  const clearEdgeCovered = Fn(() => {
    edgeCoveredBuffer.element(instanceIndex).assign(uint(0));
  })()
    .compute(edgeCount)
    .setName('Clear Strand Edge Covered');

  const edgeSpansTearGap = Fn(([edgeIdScalar]) => {
    const edgeId = uint(edgeIdScalar);
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const span = vertexPositionBuffer
      .element(vertexIds.y)
      .sub(vertexPositionBuffer.element(vertexIds.x))
      .length();
    const restLength = springRestLengthBuffer.element(edgeId).max(float(1e-6));
    return edgeVisualBuffer
      .element(edgeId)
      .equal(uint(1))
      .and(span.div(restLength).greaterThan(strandSpanGapRatio));
  });

  const markEdgeCovered = Fn(() => {
    If(instanceIndex.greaterThanEqual(dressTriangleCountUint), () => {
      Return();
    });

    const tri = uint(instanceIndex);
    If(dressTriRenderableBuffer.element(tri).equal(uint(0)), () => {
      Return();
    });

    const e0 = dressTriEdge0Buffer.element(tri);
    const e1 = dressTriEdge1Buffer.element(tri);
    const e2 = dressTriEdge2Buffer.element(tri);
    const valid0 = e0.notEqual(invalidEdgeId);
    const valid1 = e1.notEqual(invalidEdgeId);
    const valid2 = e2.notEqual(invalidEdgeId);
    const broken0 = valid0.and(isEdgeBroken(e0));
    const broken1 = valid1.and(isEdgeBroken(e1));
    const broken2 = valid2.and(isEdgeBroken(e2));

    If(broken0.or(broken1).or(broken2), () => {
      Return();
    });

    If(valid0.and(edgeSpansTearGap(e0).not()), () => {
      edgeCoveredBuffer.element(e0).assign(uint(1));
    });
    If(valid1.and(edgeSpansTearGap(e1).not()), () => {
      edgeCoveredBuffer.element(e1).assign(uint(1));
    });
    If(valid2.and(edgeSpansTearGap(e2).not()), () => {
      edgeCoveredBuffer.element(e2).assign(uint(1));
    });
  })()
    .compute(Math.max(dressTriangleCount, 1))
    .setName('Mark Strand Edge Covered');

  const clearTornAdjacencyCoverage = Fn(() => {
    If(instanceIndex.greaterThanEqual(dressTriangleCountUint), () => {
      Return();
    });

    const tri = uint(instanceIndex);
    const e0 = dressTriEdge0Buffer.element(tri);
    const e1 = dressTriEdge1Buffer.element(tri);
    const e2 = dressTriEdge2Buffer.element(tri);
    const valid0 = e0.notEqual(invalidEdgeId);
    const valid1 = e1.notEqual(invalidEdgeId);
    const valid2 = e2.notEqual(invalidEdgeId);
    const broken0 = valid0.and(isEdgeBroken(e0));
    const broken1 = valid1.and(isEdgeBroken(e1));
    const broken2 = valid2.and(isEdgeBroken(e2));

    If(broken0.or(broken1).or(broken2).not(), () => {
      Return();
    });

    If(valid0.and(isEdgeBroken(e0).not()), () => {
      edgeCoveredBuffer.element(e0).assign(uint(0));
    });
    If(valid1.and(isEdgeBroken(e1).not()), () => {
      edgeCoveredBuffer.element(e1).assign(uint(0));
    });
    If(valid2.and(isEdgeBroken(e2).not()), () => {
      edgeCoveredBuffer.element(e2).assign(uint(0));
    });
  })()
    .compute(Math.max(dressTriangleCount, 1))
    .setName('Clear Strand Torn Adjacency Coverage');

  const clearSpanGapCoverage = Fn(() => {
    If(instanceIndex.greaterThanEqual(edgeCountUint), () => {
      Return();
    });

    const edgeId = uint(instanceIndex);
    If(edgeSpansTearGap(edgeId), () => {
      edgeCoveredBuffer.element(edgeId).assign(uint(0));
    });
  })()
    .compute(edgeCount)
    .setName('Clear Strand Span Gap Coverage');

  const updateStrandVisibility = Fn(() => {
    If(instanceIndex.greaterThanEqual(edgeCountUint), () => {
      Return();
    });

    const edgeId = uint(instanceIndex);
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const v0 = vertexIds.x;
    const v1 = vertexIds.y;
    const active = edgeVisualBuffer.element(edgeId).equal(uint(1));
    const isStructural = edgeKindBuffer.element(edgeId).equal(uint(0));
    const sameComponent = vertexComponentBuffer.element(v0).equal(vertexComponentBuffer.element(v1));
    const notPinned = vertexParamsBuffer
      .element(v0)
      .x.equal(uint(0))
      .and(vertexParamsBuffer.element(v1).x.equal(uint(0)));
    const uncovered = edgeCoveredBuffer.element(edgeId).equal(uint(0));
    const show = active
      .and(isStructural)
      .and(sameComponent)
      .and(notPinned)
      .and(uncovered);

    strandEdgeVisibleBuffer.element(edgeId).assign(select(show, uint(1), uint(0)));
  })()
    .compute(edgeCount)
    .setName('Update Strand Edge Visibility');

  return {
    updateDressTriRenderable,
    clearEdgeCovered,
    markEdgeCovered,
    clearTornAdjacencyCoverage,
    clearSpanGapCoverage,
    updateStrandVisibility,
  };
}

type Vec3InstancedBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<THREE.Vector3>;
};

export interface GpuStrandThreadMeshOptions {
  springVertexIdBuffer: Uvec2Buffer;
  vertexPositionBuffer: Vec3Buffer;
  strandEdgeVisibleBuffer: UintBuffer;
  edgeSegmentIdBuffer?: UintBuffer;
  segmentScalars1Buffer?: Vec3InstancedBuffer;
  maxCount: number;
  radius: UniformNode<number>;
  color: THREE.Color;
}

function strandColorNode(options: GpuStrandThreadMeshOptions): ShaderNodeObject<THREE.Vector3> {
  const { segmentScalars1Buffer, edgeSegmentIdBuffer, color } = options;
  if (segmentScalars1Buffer && edgeSegmentIdBuffer) {
    return Fn(() => {
      const edgeId = uint(instanceIndex);
      const segId = edgeSegmentIdBuffer.element(edgeId);
      return segmentScalars1Buffer.element(segId).xyz;
    })();
  }
  return Fn(() => vec3(color.r, color.g, color.b))();
}

export function createGpuStrandThreadMesh(options: GpuStrandThreadMeshOptions): THREE.InstancedMesh {
  const {
    springVertexIdBuffer,
    vertexPositionBuffer,
    strandEdgeVisibleBuffer,
    maxCount,
    radius,
    color,
  } = options;

  const strandVisibleVarying = varyingProperty('float', 'vStrandVisible');

  const material = new THREE.MeshBasicNodeMaterial({
    color,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    depthWrite: true,
    alphaTest: 0.5,
  });

  material.colorNode = strandColorNode(options);
  material.opacityNode = Fn(() => strandVisibleVarying)();
  material.positionNode = Fn(() => {
    const edgeId = uint(instanceIndex);
    const visible = strandEdgeVisibleBuffer.element(edgeId).equal(uint(1));
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const p0 = vertexPositionBuffer.element(vertexIds.x);
    const p1 = vertexPositionBuffer.element(vertexIds.y);
    const axis = p1.sub(p0).toVar('strandAxis');
    const length = axis.length();
    const direction = axis.div(length.max(float(1e-6)));
    const refAxis = select(abs(direction.y).lessThan(float(0.9)), vec3(0, 1, 0), vec3(1, 0, 0));
    const tangent = cross(refAxis, direction).normalize();
    const bitangent = cross(direction, tangent).normalize();
    const local = attribute('position');
    const spanT = local.y.add(0.5);
    const radial = tangent.mul(local.x).add(bitangent.mul(local.z)).mul(radius);
    const pos = p0.add(direction.mul(spanT.mul(length))).add(radial);
    const show = select(visible.and(length.greaterThan(radius.mul(0.5))), float(1), float(0));
    show.toVarying(strandVisibleVarying);
    return pos;
  })();

  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), material, maxCount);
  mesh.name = 'strand-thread-visual-gpu';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.count = 0;
  return mesh;
}

export function createGpuStrandThreadCapMesh(options: GpuStrandThreadMeshOptions): THREE.InstancedMesh {
  const {
    springVertexIdBuffer,
    vertexPositionBuffer,
    strandEdgeVisibleBuffer,
    maxCount,
    radius,
    color,
  } = options;

  const strandVisibleVarying = varyingProperty('float', 'vStrandCapVisible');
  const capRadius = radius.mul(1.05);

  const material = new THREE.MeshBasicNodeMaterial({
    color,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    depthWrite: true,
    alphaTest: 0.5,
  });

  material.colorNode = strandColorNode(options);
  material.opacityNode = Fn(() => strandVisibleVarying)();
  material.positionNode = Fn(() => {
    const capSlot = uint(instanceIndex);
    const edgeId = capSlot.div(uint(2));
    const useEnd = capSlot.mod(uint(2)).equal(uint(1));
    const visible = strandEdgeVisibleBuffer.element(edgeId).equal(uint(1));
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const p0 = vertexPositionBuffer.element(vertexIds.x);
    const p1 = vertexPositionBuffer.element(vertexIds.y);
    const center = select(useEnd, p1, p0);
    const local = attribute('position');
    const pos = center.add(local.mul(capRadius));
    const show = select(visible, float(1), float(0));
    show.toVarying(strandVisibleVarying);
    return pos;
  })();

  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 6), material, maxCount * 2);
  mesh.name = 'strand-thread-cap-visual-gpu';
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.count = 0;
  return mesh;
}

export function updateGpuStrandThreadMaterial(
  mesh: THREE.InstancedMesh,
  color: THREE.Color,
  radius: number,
): void {
  const material = mesh.material as THREE.MeshBasicNodeMaterial;
  material.color.copy(color);
  mesh.userData.strandThreadRadius = radius;
}
