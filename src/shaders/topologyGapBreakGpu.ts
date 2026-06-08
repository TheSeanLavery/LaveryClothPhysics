import {
  Fn,
  If,
  Return,
  float,
  instanceIndex,
  select,
  uint,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

type UintBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

type Vec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<import('three').Vector3>;
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

type FloatBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

export interface TopologyGapBreakGpuOptions {
  edgeCount: number;
  dressTriangleCount: number;
  edgeActiveBuffer: UintBuffer;
  edgeKindBuffer: UintBuffer;
  vertexParamsBuffer: Uvec3Buffer;
  vertexPositionBuffer: Vec3Buffer;
  springVertexIdBuffer: Uvec2Buffer;
  springRestLengthBuffer: FloatBuffer;
  dressTriEdge0Buffer: UintBuffer;
  dressTriEdge1Buffer: UintBuffer;
  dressTriEdge2Buffer: UintBuffer;
  /** Break active edges stretched past this ratio (assembly topology gaps). */
  topologyGapBreakRatio: UniformNode<number>;
  /** Break rim edges on torn tris when stretched past this ratio. */
  tornRimGapBreakRatio: UniformNode<number>;
}

export interface TopologyGapBreakGpuPasses {
  breakEdgesOnFabricHoles: ReturnType<ReturnType<typeof Fn>['compute']>;
  breakEdgesBySpanningGap: ReturnType<ReturnType<typeof Fn>['compute']>;
}

const invalidEdgeId = uint(0xffffffff);

export function createTopologyGapBreakCompute(
  options: TopologyGapBreakGpuOptions,
): TopologyGapBreakGpuPasses {
  const {
    edgeCount,
    dressTriangleCount,
    edgeActiveBuffer,
    edgeKindBuffer,
    vertexParamsBuffer,
    vertexPositionBuffer,
    springVertexIdBuffer,
    springRestLengthBuffer,
    dressTriEdge0Buffer,
    dressTriEdge1Buffer,
    dressTriEdge2Buffer,
    topologyGapBreakRatio,
    tornRimGapBreakRatio,
  } = options;

  const edgeCountUint = uint(edgeCount);
  const dressTriangleCountUint = uint(dressTriangleCount);

  const isEdgeBroken = Fn(([edgeIdScalar]) => {
    const edgeId = uint(edgeIdScalar);
    return edgeIdScalar
      .greaterThanEqual(float(0))
      .and(edgeActiveBuffer.element(edgeId).equal(uint(0)));
  });

  const edgeSpanRatio = Fn(([edgeIdScalar]) => {
    const edgeId = uint(edgeIdScalar);
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const span = vertexPositionBuffer
      .element(vertexIds.y)
      .sub(vertexPositionBuffer.element(vertexIds.x))
      .length();
    const restLength = springRestLengthBuffer.element(edgeId).max(float(1e-6));
    return span.div(restLength);
  });

  const breakEdgesOnFabricHoles = Fn(() => {
    If(dressTriangleCountUint.equal(uint(0)), () => {
      Return();
    });

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
    const brokenCount = select(broken0, uint(1), uint(0))
      .add(select(broken1, uint(1), uint(0)))
      .add(select(broken2, uint(1), uint(0)));

    If(brokenCount.greaterThanEqual(uint(2)), () => {
      If(valid0.and(isEdgeBroken(e0).not()), () => {
        edgeActiveBuffer.element(e0).assign(uint(0));
      });
      If(valid1.and(isEdgeBroken(e1).not()), () => {
        edgeActiveBuffer.element(e1).assign(uint(0));
      });
      If(valid2.and(isEdgeBroken(e2).not()), () => {
        edgeActiveBuffer.element(e2).assign(uint(0));
      });
      Return();
    });

    If(brokenCount.greaterThan(uint(0)), () => {
      If(valid0.and(isEdgeBroken(e0).not()).and(edgeSpanRatio(e0).greaterThan(tornRimGapBreakRatio)), () => {
        edgeActiveBuffer.element(e0).assign(uint(0));
      });
      If(valid1.and(isEdgeBroken(e1).not()).and(edgeSpanRatio(e1).greaterThan(tornRimGapBreakRatio)), () => {
        edgeActiveBuffer.element(e1).assign(uint(0));
      });
      If(valid2.and(isEdgeBroken(e2).not()).and(edgeSpanRatio(e2).greaterThan(tornRimGapBreakRatio)), () => {
        edgeActiveBuffer.element(e2).assign(uint(0));
      });
    });
  })()
    .compute(Math.max(dressTriangleCount, 1))
    .setName('Break Edges On Fabric Holes');

  const breakEdgesBySpanningGap = Fn(() => {
    If(instanceIndex.greaterThanEqual(edgeCountUint), () => {
      Return();
    });

    const edgeId = uint(instanceIndex);
    If(edgeActiveBuffer.element(edgeId).equal(uint(0)), () => {
      Return();
    });
    const edgeKind = edgeKindBuffer.element(edgeId);
    If(edgeKind.equal(uint(1)).or(edgeKind.equal(uint(2))).or(edgeKind.equal(uint(3))), () => {
      Return();
    });

    const vertexIds = springVertexIdBuffer.element(edgeId);
    const v0Fixed = vertexParamsBuffer.element(vertexIds.x).x;
    const v1Fixed = vertexParamsBuffer.element(vertexIds.y).x;
    If(v0Fixed.or(v1Fixed), () => {
      Return();
    });

    If(edgeSpanRatio(edgeId).greaterThan(topologyGapBreakRatio), () => {
      edgeActiveBuffer.element(edgeId).assign(uint(0));
    });
  })()
    .compute(edgeCount)
    .setName('Break Edges By Spanning Gap');

  return {
    breakEdgesOnFabricHoles,
    breakEdgesBySpanningGap,
  };
}

export function createBreakCrossComponentEdgesCompute(options: {
  edgeCount: number;
  edgeActiveBuffer: UintBuffer;
  edgeKindBuffer: UintBuffer;
  vertexComponentBuffer: UintBuffer;
  springVertexIdBuffer: Uvec2Buffer;
  vertexParamsBuffer: Uvec3Buffer;
}): ReturnType<ReturnType<typeof Fn>['compute']> {
  const {
    edgeCount,
    edgeActiveBuffer,
    edgeKindBuffer,
    vertexComponentBuffer,
    springVertexIdBuffer,
    vertexParamsBuffer,
  } = options;

  return Fn(() => {
    If(instanceIndex.greaterThanEqual(uint(edgeCount)), () => {
      Return();
    });

    const edgeId = uint(instanceIndex);
    If(edgeActiveBuffer.element(edgeId).equal(uint(0)), () => {
      Return();
    });
    If(edgeKindBuffer.element(edgeId).equal(uint(1)), () => {
      Return();
    });

    const vertexIds = springVertexIdBuffer.element(edgeId);
    const v0Fixed = vertexParamsBuffer.element(vertexIds.x).x;
    const v1Fixed = vertexParamsBuffer.element(vertexIds.y).x;
    If(v0Fixed.or(v1Fixed), () => {
      Return();
    });

    const sameComponent = vertexComponentBuffer
      .element(vertexIds.x)
      .equal(vertexComponentBuffer.element(vertexIds.y));
    If(sameComponent.not(), () => {
      edgeActiveBuffer.element(edgeId).assign(uint(0));
    });
  })()
    .compute(edgeCount)
    .setName('Break Cross Component Active Edges');
}
