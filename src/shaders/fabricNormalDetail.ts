import {
  Fn,
  cameraViewMatrix,
  directionToFaceDirection,
  float,
  mix,
  transformNormalToView,
  vec3,
  type ShaderNodeObject,
} from 'three/tsl';
import type { MatteCottonFlagMaterialUniforms } from './FlagClothMaterial';

type Vec3Node = ShaderNodeObject<THREE.Node>;

export interface FabricNormalMapOptions {
  /** World-space sim varyings (flag). Face correction runs once on the final normal. */
  fromWorldSpace?: boolean;
}

/**
 * UV-aligned weave normal detail.
 * TBN: +X fly tangent, +Y hoist bitangent (N × T), +Z geometry normal.
 */
export function createApplyFabricNormalMapFn(
  sampleWeave: ReturnType<typeof Fn>,
  clothUniforms: MatteCottonFlagMaterialUniforms,
  geomNormal: Vec3Node,
  flyTangent: Vec3Node,
  options: FabricNormalMapOptions = {},
) {
  const { fromWorldSpace = false } = options;

  return Fn(() => {
    const geomN = geomNormal.normalize();
    const flyT = flyTangent.normalize();
    const flyTOrtho = flyT.sub(geomN.mul(geomN.dot(flyT))).normalize();
    const hoistB = geomN.cross(flyTOrtho).normalize();

    const mapSample = sampleWeave();
    const mapNormal = mapSample.rgb.mul(2).sub(1);
    const scale = clothUniforms.fabricNormalScale;
    const tsNormal = vec3(mapNormal.x.mul(scale), mapNormal.y.mul(scale), mapNormal.z);

    const perturbedWorld = flyTOrtho
      .mul(tsNormal.x)
      .add(hoistB.mul(tsNormal.y))
      .add(geomN.mul(tsNormal.z))
      .normalize();

    const strength = clothUniforms.fabricNormalStrength.clamp(0, 1);
    const blendedWorld = mix(geomN, perturbedWorld, strength).normalize();

    if (fromWorldSpace) {
      return directionToFaceDirection(
        blendedWorld.transformDirection(cameraViewMatrix).normalize(),
      );
    }

    const perturbedView = flyTOrtho
      .mul(tsNormal.x)
      .add(hoistB.mul(tsNormal.y))
      .add(geomN.mul(tsNormal.z))
      .normalize();
    return mix(geomN, perturbedView, strength).normalize();
  });
}

/** Fly tangent for an axis-aligned XY plane facing +Z (local +X = fly). */
export function planeFlyTangentView(geomNormalView: Vec3Node): Vec3Node {
  const flyRaw = transformNormalToView(vec3(1, 0, 0));
  return flyRaw.sub(geomNormalView.mul(geomNormalView.dot(flyRaw))).normalize();
}
