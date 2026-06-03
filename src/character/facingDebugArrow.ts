import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const TMP_DIR = new THREE.Vector3();

/** Ground arrow showing intended facing (XZ yaw). */
export class FacingDebugArrow {
  private readonly root = new THREE.Group();
  private readonly arrow: THREE.ArrowHelper;

  constructor(
    scene: THREE.Scene,
    color: number,
    name: string,
    length = 1.35,
  ) {
    this.root.name = name;
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0.04, 0),
      length,
      color,
      length * 0.31,
      length * 0.18,
    );
    this.root.add(this.arrow);
    scene.add(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Point along world XZ direction (e.g. WASD velocity or toward opponent). */
  updateDirection(position: THREE.Vector3, dirX: number, dirZ: number): void {
    this.root.position.set(position.x, 0.04, position.z);
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) {
      TMP_DIR.set(0, 0, -1);
    } else {
      TMP_DIR.set(dirX / len, 0, dirZ / len);
    }
    this.arrow.setDirection(TMP_DIR);
  }

  /** `root.rotation.y` — mesh forward axis, not necessarily velocity. */
  updateRootYaw(position: THREE.Vector3, yawRad: number): void {
    this.root.position.set(position.x, 0.04, position.z);
    TMP_DIR.set(0, 0, -1).applyAxisAngle(UP, yawRad);
    this.arrow.setDirection(TMP_DIR);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.arrow.dispose();
  }
}
