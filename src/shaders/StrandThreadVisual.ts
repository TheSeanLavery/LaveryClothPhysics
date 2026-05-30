import * as THREE from 'three/webgpu';

export interface StrandThreadEdge {
  readonly v0: number;
  readonly v1: number;
}

const threadUpAxis = new THREE.Vector3(0, 1, 0);
const threadPosition = new THREE.Vector3();
const threadDirection = new THREE.Vector3();
const threadQuaternion = new THREE.Quaternion();
const threadScale = new THREE.Vector3();
const threadMatrix = new THREE.Matrix4();

export function createStrandThreadInstancedMesh(
  maxCount: number,
  color: THREE.Color,
): THREE.InstancedMesh {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.name = 'strand-thread-visual';
  mesh.renderOrder = 11;
  return mesh;
}

export function syncStrandThreadInstancedMesh(
  mesh: THREE.InstancedMesh,
  strandEdgeIds: readonly number[],
  edgeVertices: readonly StrandThreadEdge[],
  positions: Float32Array,
  positionStride: number,
  radius: number,
): void {
  mesh.count = strandEdgeIds.length;
  mesh.visible = strandEdgeIds.length > 0;

  if (strandEdgeIds.length === 0) {
    return;
  }

  const minLength = radius * 2.5;

  for (let i = 0; i < strandEdgeIds.length; i++) {
    const edge = edgeVertices[strandEdgeIds[i]!]!;
    const p0x = positions[edge.v0 * positionStride]!;
    const p0y = positions[edge.v0 * positionStride + 1]!;
    const p0z = positions[edge.v0 * positionStride + 2]!;
    const p1x = positions[edge.v1 * positionStride]!;
    const p1y = positions[edge.v1 * positionStride + 1]!;
    const p1z = positions[edge.v1 * positionStride + 2]!;

    threadDirection.set(p1x - p0x, p1y - p0y, p1z - p0z);
    const length = threadDirection.length();
    if (length < minLength) {
      threadDirection.set(0, minLength, 0);
    } else {
      threadDirection.divideScalar(length);
    }

    threadPosition.set(
      (p0x + p1x) * 0.5,
      (p0y + p1y) * 0.5,
      (p0z + p1z) * 0.5,
    );
    threadQuaternion.setFromUnitVectors(threadUpAxis, threadDirection.normalize());
    const span = Math.max(length, minLength);
    threadScale.set(radius, span, radius);
    threadMatrix.compose(threadPosition, threadQuaternion, threadScale);
    mesh.setMatrixAt(i, threadMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
}

export function updateStrandThreadMaterial(
  mesh: THREE.InstancedMesh,
  color: THREE.Color,
  radius: number,
): void {
  const material = mesh.material as THREE.MeshBasicNodeMaterial;
  material.color.copy(color);
  mesh.userData.strandThreadRadius = radius;
}
