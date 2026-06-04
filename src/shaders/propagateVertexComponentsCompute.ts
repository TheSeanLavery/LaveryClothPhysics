import { Fn, If, instanceIndex, min, uint } from 'three/tsl';
import type { instancedArray } from 'three/tsl';

type UintGpuBuffer = ReturnType<typeof instancedArray>;
type EdgeVertsGpuBuffer = ReturnType<typeof instancedArray>;

export interface PropagateVertexComponentsComputeOptions {
  vertexCount: number;
  edgeCount: number;
  vertexComponentBuffer: UintGpuBuffer;
  edgeActiveBuffer: UintGpuBuffer;
  springVertexIdBuffer: EdgeVertsGpuBuffer;
}

export interface PropagateVertexComponentsComputePasses {
  initVertexComponentLabels: ReturnType<ReturnType<typeof Fn>['compute']>;
  propagateVertexComponentLabels: ReturnType<ReturnType<typeof Fn>['compute']>;
}

/**
 * Relabel vertexComponentBuffer from edgeActive (parallel min-label propagation).
 * Does NOT modify edgeActive — safe for sim + render component tests.
 */
export function createPropagateVertexComponentsCompute(
  options: PropagateVertexComponentsComputeOptions,
): PropagateVertexComponentsComputePasses {
  const { vertexCount, edgeCount, vertexComponentBuffer, edgeActiveBuffer, springVertexIdBuffer } =
    options;

  const initVertexComponentLabels = Fn(() => {
    vertexComponentBuffer.element(instanceIndex).assign(uint(instanceIndex));
  })()
    .compute(vertexCount)
    .setName('Init Vertex Component Labels');

  const propagateVertexComponentLabels = Fn(() => {
    const edgeId = uint(instanceIndex);
    If(edgeActiveBuffer.element(edgeId).equal(uint(1)), () => {
      const verts = springVertexIdBuffer.element(edgeId);
      const label = min(
        vertexComponentBuffer.element(verts.x),
        vertexComponentBuffer.element(verts.y),
      );
      vertexComponentBuffer.element(verts.x).assign(
        min(vertexComponentBuffer.element(verts.x), label),
      );
      vertexComponentBuffer.element(verts.y).assign(
        min(vertexComponentBuffer.element(verts.y), label),
      );
    });
  })()
    .compute(edgeCount)
    .setName('Propagate Vertex Component Labels');

  return {
    initVertexComponentLabels,
    propagateVertexComponentLabels,
  };
}
