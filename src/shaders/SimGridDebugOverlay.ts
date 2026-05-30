import * as THREE from 'three/webgpu';
import {
  Fn,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  instanceIndex,
  select,
  uniform,
  vec2,
  vec3,
  vec4,
  type ShaderNodeObject,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

export interface SimGridDebugOverlayUniforms {
  mouseNdc: UniformNode<THREE.Vector2>;
  visible: UniformNode<number>;
  pickRadius: UniformNode<number>;
  pointSize: UniformNode<number>;
  highlightSize: UniformNode<number>;
}

export interface SimGridDebugOverlay {
  sprite: THREE.Sprite;
  material: THREE.PointsNodeMaterial;
  uniforms: SimGridDebugOverlayUniforms;
  dispose: () => void;
}

type InstancedVec3Buffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<THREE.Vector3>;
};

export function createSimGridDebugOverlay(
  vertexPositionBuffer: InstancedVec3Buffer,
  particleCount: number,
  mouseNdc: UniformNode<THREE.Vector2>,
): SimGridDebugOverlay {
  const uniforms: SimGridDebugOverlayUniforms = {
    mouseNdc,
    visible: uniform(0),
    pickRadius: uniform(0.028),
    pointSize: uniform(5),
    highlightSize: uniform(12),
  };

  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: false,
  });

  const worldPos = vertexPositionBuffer.element(instanceIndex);

  material.positionNode = worldPos;

  const screenDistanceToMouse = Fn(() => {
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(worldPos, float(1)));
    const ndc = clip.xy.div(clip.w);
    return ndc.sub(uniforms.mouseNdc).length();
  });

  const isMouseActive = Fn(() => uniforms.mouseNdc.x.greaterThan(float(-1.5)));

  const isHovered = Fn(() => isMouseActive().and(screenDistanceToMouse().lessThan(uniforms.pickRadius)));

  material.sizeNode = Fn(() => {
    const size = select(isHovered(), uniforms.highlightSize, uniforms.pointSize);
    return vec2(size);
  })();

  material.colorNode = Fn(() => {
    const baseColor = vec3(0.35, 0.85, 1.0);
    const hoverColor = vec3(1.0, 0.92, 0.2);
    return select(isHovered(), hoverColor, baseColor).mul(uniforms.visible);
  })();

  material.opacityNode = uniforms.visible;

  const sprite = new THREE.Sprite(material);
  sprite.count = particleCount;
  sprite.frustumCulled = false;
  sprite.name = 'sim-grid-debug-overlay';
  sprite.renderOrder = 10;

  return {
    sprite,
    material,
    uniforms,
    dispose: () => {
      material.dispose();
    },
  };
}
