import * as THREE from 'three/webgpu';

export interface EyeBlinkConfig {
  enabled: boolean;
  minInterval: number;
  maxInterval: number;
  blinkDuration: number;
  doubleBlinkChance: number;
  manualClose: number;
}

export const DEFAULT_EYE_BLINK_CONFIG: EyeBlinkConfig = {
  enabled: true,
  minInterval: 2.0,
  maxInterval: 6.0,
  blinkDuration: 0.15,
  doubleBlinkChance: 0.2,
  manualClose: 0,
};

export class EyeBlinkSystem {
  readonly config: EyeBlinkConfig;

  private blinkAmount = 0;
  private blinkTimer = 0;
  private nextBlinkAt: number;
  private blinkPhase: 'idle' | 'closing' | 'opening' | 'pause' = 'idle';
  private pendingDoubleBlink = false;
  private initialized = false;
  private readonly morphMeshes: { mesh: THREE.SkinnedMesh; morphIndex: number }[] = [];

  constructor(config: Partial<EyeBlinkConfig> = {}) {
    this.config = { ...DEFAULT_EYE_BLINK_CONFIG, ...config };
    this.nextBlinkAt = this.randomInterval();
  }

  init(
    loadedRoot: THREE.Object3D,
    headBone: THREE.Bone,
    getSkinnedPos: (mesh: THREE.SkinnedMesh, index: number, target: THREE.Vector3) => THREE.Vector3,
  ): void {
    if (this.initialized) {
      return;
    }

    const headPos = headBone.getWorldPosition(new THREE.Vector3());

    loadedRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh) || !object.skeleton) return;
      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      const skinIndexAttr = geometry.getAttribute('skinIndex');
      const skinWeightAttr = geometry.getAttribute('skinWeight');
      if (!positionAttr || !skinIndexAttr || !skinWeightAttr) return;

      const headBoneIndex = object.skeleton.bones.findIndex((bone) =>
        /head$/i.test(bone.name.replace(/^mixamorig/i, '')),
      );
      if (headBoneIndex < 0) return;

      const vertexCount = positionAttr.count;
      const worldPositions: THREE.Vector3[] = [];
      const headWeights: number[] = [];
      const tmp = new THREE.Vector3();

      for (let index = 0; index < vertexCount; index++) {
        getSkinnedPos(object, index, tmp);
        worldPositions.push(tmp.clone());

        let headWeight = 0;
        for (let influence = 0; influence < Math.min(4, skinWeightAttr.itemSize); influence++) {
          if (Math.round(skinIndexAttr.getComponent(index, influence)) === headBoneIndex) {
            headWeight += skinWeightAttr.getComponent(index, influence);
          }
        }
        headWeights.push(headWeight);
      }

      const headVerts = worldPositions
        .map((position, index) => ({ position, index, weight: headWeights[index] ?? 0 }))
        .filter((vertex) => vertex.weight > 0.3);
      if (headVerts.length === 0) return;

      const ys = headVerts.map((vertex) => vertex.position.y);
      const zs = headVerts.map((vertex) => vertex.position.z);
      const xs = headVerts.map((vertex) => vertex.position.x);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const maxZ = Math.max(...zs);
      const headHeight = maxY - minY;
      const avgX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
      if (headHeight <= 0) return;

      const eyeMidY = headPos.y + headHeight * 0.18;
      const eyeBandHalfHeight = headHeight * 0.07;
      const frontThreshold = maxZ - headHeight * 0.28;
      const frontDenominator = Math.max(0.0001, maxZ - frontThreshold);
      const morphArray = new Float32Array(vertexCount * 3);
      let hasDisplacement = false;

      const normalMatrix = new THREE.Matrix3().setFromMatrix4(object.bindMatrixInverse);
      const localDown = new THREE.Vector3(0, -1, 0).applyMatrix3(normalMatrix).normalize();
      const localUp = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();

      for (let index = 0; index < vertexCount; index++) {
        if ((headWeights[index] ?? 0) < 0.2) continue;

        const worldPosition = worldPositions[index]!;
        if (worldPosition.z < frontThreshold) continue;

        const dy = worldPosition.y - eyeMidY;
        const absDy = Math.abs(dy);
        if (absDy > eyeBandHalfHeight * 2.5) continue;

        const dx = Math.abs(worldPosition.x - avgX);
        if (dx < headHeight * 0.03 || dx > headHeight * 0.22) continue;

        const normalizedDy = absDy / eyeBandHalfHeight;
        const bandWeight = Math.max(0, 1 - normalizedDy * normalizedDy);
        const frontWeight = Math.max(0, Math.min(1, (worldPosition.z - frontThreshold) / frontDenominator));
        const weight = bandWeight * frontWeight * (headWeights[index] ?? 0);
        if (weight < 0.01) continue;

        hasDisplacement = true;
        const attributeIndex = index * 3;
        const closeDistance = eyeBandHalfHeight * 2.0 * weight;

        if (dy > 0) {
          morphArray[attributeIndex] += localDown.x * closeDistance;
          morphArray[attributeIndex + 1] += localDown.y * closeDistance;
          morphArray[attributeIndex + 2] += localDown.z * closeDistance;
        } else {
          const lowerScale = 0.15;
          morphArray[attributeIndex] += localUp.x * closeDistance * lowerScale;
          morphArray[attributeIndex + 1] += localUp.y * closeDistance * lowerScale;
          morphArray[attributeIndex + 2] += localUp.z * closeDistance * lowerScale;
        }
      }

      if (!hasDisplacement) return;

      const existing = geometry.morphAttributes.position ?? [];
      const attr = new THREE.Float32BufferAttribute(morphArray, 3);
      attr.name = 'eyeBlink';
      geometry.morphAttributes.position = [...existing, attr];
      geometry.morphTargetsRelative = true;

      const morphIndex = object.morphTargetInfluences?.length ?? 0;
      const newInfluences = new Array(morphIndex + 1).fill(0);
      if (object.morphTargetInfluences) {
        for (let index = 0; index < morphIndex; index++) {
          newInfluences[index] = object.morphTargetInfluences[index];
        }
      }
      object.morphTargetInfluences = newInfluences;
      object.updateMorphTargets();

      this.morphMeshes.push({ mesh: object, morphIndex });
    });

    this.initialized = this.morphMeshes.length > 0;
  }

  update(delta: number): void {
    if (!this.initialized) return;

    if (this.config.manualClose > 0) {
      this.blinkAmount = this.config.manualClose;
      this.syncMorphInfluence();
      return;
    }

    if (!this.config.enabled) {
      this.blinkAmount = 0;
      this.syncMorphInfluence();
      return;
    }

    const halfDuration = this.config.blinkDuration * 0.5;

    if (this.blinkPhase === 'idle') {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkAt) {
        this.blinkPhase = 'closing';
        this.blinkTimer = 0;
        this.pendingDoubleBlink = Math.random() < this.config.doubleBlinkChance;
      }
    } else if (this.blinkPhase === 'closing') {
      this.blinkTimer += delta;
      this.blinkAmount = Math.min(1, this.blinkTimer / halfDuration);
      if (this.blinkTimer >= halfDuration) {
        this.blinkPhase = 'opening';
        this.blinkTimer = 0;
      }
    } else if (this.blinkPhase === 'opening') {
      this.blinkTimer += delta;
      this.blinkAmount = Math.max(0, 1 - this.blinkTimer / halfDuration);
      if (this.blinkTimer >= halfDuration) {
        if (this.pendingDoubleBlink) {
          this.pendingDoubleBlink = false;
          this.blinkPhase = 'pause';
          this.blinkTimer = 0;
        } else {
          this.blinkPhase = 'idle';
          this.blinkTimer = 0;
          this.nextBlinkAt = this.randomInterval();
        }
        this.blinkAmount = 0;
      }
    } else if (this.blinkPhase === 'pause') {
      this.blinkTimer += delta;
      if (this.blinkTimer >= 0.08) {
        this.blinkPhase = 'closing';
        this.blinkTimer = 0;
      }
    }

    this.syncMorphInfluence();
  }

  triggerBlink(): void {
    this.blinkPhase = 'closing';
    this.blinkTimer = 0;
  }

  getBlinkAmount(): number {
    return this.blinkAmount;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private syncMorphInfluence(): void {
    for (const { mesh, morphIndex } of this.morphMeshes) {
      if (mesh.morphTargetInfluences && morphIndex < mesh.morphTargetInfluences.length) {
        mesh.morphTargetInfluences[morphIndex] = this.blinkAmount;
      }
    }
  }

  private randomInterval(): number {
    return this.config.minInterval + Math.random() * (this.config.maxInterval - this.config.minInterval);
  }
}
