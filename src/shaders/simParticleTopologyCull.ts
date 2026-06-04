import { Fn, attribute, float, select, uint } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';

type UintBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

export interface SimParticleEdgeCullOptions {
  /** Synced from edgeActive each frame (edgeVisualBuffer). Safe in vertex shaders. */
  edgeActiveBuffer: UintBuffer;
}

/**
 * GPU triangle hide for assembly cloth: drop triangles that touch a broken structural edge.
 * Uses per-corner geometry attributes + edgeVisualBuffer (no vertexComponent storage in VS).
 */
export function createSimParticleEdgeCull(options: SimParticleEdgeCullOptions) {
  const { edgeActiveBuffer } = options;

  const isEdgeBroken = Fn(([edgeIdScalar]) => {
    const edgeId = uint(edgeIdScalar);
    return edgeIdScalar
      .greaterThanEqual(float(0))
      .and(edgeActiveBuffer.element(edgeId).equal(uint(0)));
  });

  const computeTriangleBroken = Fn(() => {
    const e0 = attribute('particleTriEdge0');
    const e1 = attribute('particleTriEdge1');
    const e2 = attribute('particleTriEdge2');
    return isEdgeBroken(e0).or(isEdgeBroken(e1)).or(isEdgeBroken(e2));
  });

  /** 1 = render triangle, 0 = hide (caller collapses position). */
  const computeTriangleVisible = Fn(() => select(computeTriangleBroken().not(), float(1), float(0)));

  return { computeTriangleBroken, computeTriangleVisible };
}
