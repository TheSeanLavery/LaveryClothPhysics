import * as THREE from 'three/webgpu';

export interface BbProjectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  alive: boolean;
  age: number;
}

const MAX_BB_COUNT = 12;

export class BbProjectilePool {
  readonly maxCount = MAX_BB_COUNT;
  private speed = 30;
  private visualRadiusValue = 0.022;
  private forceRadiusValue = 0.07;
  private readonly projectiles: BbProjectile[] = [];

  constructor() {
    for (let i = 0; i < MAX_BB_COUNT; i++) {
      this.projectiles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        alive: false,
        age: 0,
      });
    }
  }

  get visualRadius(): number {
    return this.visualRadiusValue;
  }

  get forceRadius(): number {
    return this.forceRadiusValue;
  }

  get projectileSpeed(): number {
    return this.speed;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
  }

  setVisualRadius(radius: number): void {
    this.visualRadiusValue = Math.max(0.001, radius);
  }

  setForceRadius(radius: number): void {
    this.forceRadiusValue = Math.max(0.001, radius);
  }

  fire(camera: THREE.PerspectiveCamera, mouseNdc: THREE.Vector2): BbProjectile | null {
    const slot = this.projectiles.find((bb) => !bb.alive);
    if (!slot) {
      return null;
    }

    const ray = this.getCameraRay(camera, mouseNdc);
    slot.position.copy(camera.position).addScaledVector(ray.direction, 0.35);
    slot.velocity.copy(ray.direction).multiplyScalar(this.speed);
    slot.alive = true;
    slot.age = 0;
    return slot;
  }

  getProjectile(index: number): BbProjectile {
    return this.projectiles[index]!;
  }

  reset(): void {
    for (const bb of this.projectiles) {
      bb.alive = false;
      bb.age = 0;
      bb.velocity.set(0, 0, 0);
    }
  }

  private getCameraRay(
    camera: THREE.PerspectiveCamera,
    mouseNdc: THREE.Vector2,
  ): THREE.Ray {
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction
      .set(mouseNdc.x, mouseNdc.y, 0.5)
      .unproject(camera)
      .sub(ray.origin)
      .normalize();
    return ray;
  }
}
