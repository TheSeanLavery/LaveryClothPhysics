import * as THREE from 'three/webgpu';
import { Fn, attribute, instanceIndex, vec3, float, cross, abs, select, uint } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

type UintBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

type Vec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<THREE.Vector3>;
};

type Uvec2Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<{
    x: ShaderNodeObject<number>;
    y: ShaderNodeObject<number>;
  }>;
};

export function createGpuStrandThreadMesh(
  strandEdgeIdBuffer: UintBuffer,
  springVertexIdBuffer: Uvec2Buffer,
  vertexPositionBuffer: Vec3Buffer,
  maxCount: number,
  radius: UniformNode<number>,
  color: THREE.Color,
): THREE.InstancedMesh {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  material.colorNode = Fn(() => vec3(color.r, color.g, color.b))();
  material.positionNode = Fn(() => {
    const edgeId = uint(strandEdgeIdBuffer.element(instanceIndex));
    const vertexIds = springVertexIdBuffer.element(edgeId);
    const p0 = vertexPositionBuffer.element(vertexIds.x);
    const p1 = vertexPositionBuffer.element(vertexIds.y);
    const axis = p1.sub(p0).toVar('strandAxis');
    const length = axis.length().max(radius.mul(2.5));
    const direction = axis.div(length);
    const center = p0.add(p1).mul(0.5);
    const refAxis = select(abs(direction.y).lessThan(float(0.9)), vec3(0, 1, 0), vec3(1, 0, 0));
    const tangent = cross(refAxis, direction).normalize();
    const bitangent = cross(direction, tangent).normalize();
    const local = attribute('position');

    return center
      .add(tangent.mul(local.x).mul(radius))
      .add(direction.mul(local.y).mul(length))
      .add(bitangent.mul(local.z).mul(radius));
  })();

  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), material, maxCount);
  mesh.name = 'strand-thread-visual-gpu';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
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
