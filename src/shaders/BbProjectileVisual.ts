import * as THREE from 'three/webgpu';
import { Fn, float, uniform, vec3 } from 'three/tsl';

export function createBbProjectileMesh(): THREE.Mesh {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0.25, 0.25, 0.28),
    toneMapped: false,
  });

  material.colorNode = Fn(() => vec3(0.82, 0.84, 0.88))();

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), material);
  mesh.name = 'bb-projectile';
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

export function syncBbProjectileMesh(
  mesh: THREE.Mesh,
  position: THREE.Vector3,
  radius: number,
  visible: boolean,
): void {
  mesh.visible = visible;
  if (!visible) {
    return;
  }

  mesh.position.copy(position);
  mesh.scale.setScalar(radius);
}
