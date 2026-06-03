import * as THREE from 'three/webgpu';
import { Fn, attribute, instanceIndex, vec3 } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

type InstancedVec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<THREE.Vector3>;
};

export function createGpuBbProjectileMesh(
  positionBuffer: InstancedVec3Buffer,
  maxCount: number,
  radius: UniformNode<number>,
): THREE.InstancedMesh {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0.25, 0.25, 0.28),
    toneMapped: false,
  });

  material.colorNode = Fn(() => vec3(0.82, 0.84, 0.88))();
  material.positionNode = Fn(() => {
    const center = positionBuffer.element(instanceIndex);
    const localPosition = attribute('position');
    return center.add(localPosition.mul(radius));
  })();

  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 10), material, maxCount);
  mesh.name = 'bb-projectiles-gpu';
  mesh.frustumCulled = false;
  return mesh;
}
