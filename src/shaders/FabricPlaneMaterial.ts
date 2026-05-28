import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  max,
  mix,
  normalViewGeometry,
  positionWorld,
  select,
  texture,
  triNoise3D,
  uniform,
  uint,
  uv,
  vec3,
} from 'three/tsl';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings';
import { getFabricNormalMapTexture } from '../textures/createFabricNormalMap';
import type { MatteCottonFlagMaterialUniforms } from './FlagClothMaterial';
import { createApplyFabricNormalMapFn, planeFlyTangentView } from './fabricNormalDetail';

export interface FabricPlaneMaterialOptions {
  settings: InextensibleFlagSettings;
  planeWidth: number;
  planeHeight: number;
  flatShadingUniform: ReturnType<typeof uniform>;
  normalFlat: unknown;
}

/**
 * Static XY plane material: built-in geometry UVs scaled to meters,
 * UV-aligned TBN (+X fly, +Y hoist, +Z normal). No sim buffer sampling.
 */
export function configureFabricPlaneMaterial(
  material: THREE.MeshPhysicalNodeMaterial,
  options: FabricPlaneMaterialOptions,
): void {
  const { settings, planeWidth, planeHeight, flatShadingUniform, normalFlat } = options;

  const clothUniforms: MatteCottonFlagMaterialUniforms = {
    baseColor: uniform(new THREE.Color(settings.flagColor)),
    roughness: uniform(settings.roughness),
    sheen: uniform(settings.sheen),
    fabricNormalStrength: uniform(settings.fabricNormalStrength),
    fabricNormalScale: uniform(settings.fabricNormalScale),
    fabricTiling: uniform(settings.fabricTiling),
  };

  const debugViewUniform = uniform(0);
  const fabricNormalTexture = getFabricNormalMapTexture();
  const planeSizeUniform = uniform(new THREE.Vector2(planeWidth, planeHeight));

  const fabricUvMeters = Fn(() => uv().mul(planeSizeUniform));

  const sampleWeave = Fn(() => {
    const fabricUv = fabricUvMeters().mul(clothUniforms.fabricTiling);
    return texture(fabricNormalTexture, fabricUv);
  });

  const computeWeaveColor = Fn(() => {
    const mapSample = sampleWeave();
    const strength = clothUniforms.fabricNormalStrength;

    const warpTint = clothUniforms.baseColor.mul(1.2);
    const weftTint = clothUniforms.baseColor.mul(0.78);
    const warpOver = mapSample.r.greaterThan(mapSample.g);
    const macroColor = mix(weftTint, warpTint, select(warpOver, float(1), float(0)));

    const groove = float(1).sub(float(1).sub(mapSample.b).mul(0.32).mul(strength));
    const woven = max(macroColor.mul(groove), clothUniforms.baseColor.mul(0.72));
    return mix(clothUniforms.baseColor, woven, strength.clamp(0, 2));
  });

  const computeDebugColor = Fn(() => {
    const planeUv = uv();
    const uvNorm = vec3(planeUv.x, planeUv.y, float(0.15));

    return select(
      debugViewUniform.equal(uint(1)),
      uvNorm,
      select(
        debugViewUniform.equal(uint(2)),
        sampleWeave().rgb,
        select(debugViewUniform.equal(uint(3)), computeWeaveColor(), vec3(0)),
      ),
    );
  });

  const applyFabricNormalMap = createApplyFabricNormalMapFn(
    sampleWeave,
    clothUniforms,
    normalViewGeometry,
    planeFlyTangentView(normalViewGeometry),
  );

  const shadedColor = computeWeaveColor();
  const debugColor = computeDebugColor();
  const isDebugView = debugViewUniform.greaterThan(uint(0));

  material.userData.matteCottonUniforms = clothUniforms;
  material.userData.fabricPlaneDebugView = debugViewUniform;
  material.transparent = false;
  material.transmission = 0;
  material.thickness = 0;
  material.ior = 1.5;
  material.side = THREE.FrontSide;
  material.sheenRoughness = settings.sheenRoughness;
  material.sheenColor = new THREE.Color(settings.flagColor);
  material.envMapIntensity = 1.15;
  material.colorNode = select(isDebugView, vec3(0), shadedColor);
  material.emissiveNode = select(isDebugView, debugColor, vec3(0));
  material.emissiveIntensity = 1;

  const microRoughness = triNoise3D(positionWorld.mul(90), 1, float(0)).x;
  material.roughnessNode = mix(
    clothUniforms.roughness.mul(0.94),
    clothUniforms.roughness.mul(1.06),
    microRoughness,
  );

  material.normalNode = select(flatShadingUniform.equal(uint(1)), normalFlat, applyFabricNormalMap());
}

export function updateFabricPlaneMaterial(
  material: THREE.MeshPhysicalNodeMaterial,
  settings: InextensibleFlagSettings,
): void {
  const clothUniforms = material.userData.matteCottonUniforms as MatteCottonFlagMaterialUniforms | undefined;
  if (!clothUniforms) {
    return;
  }

  clothUniforms.baseColor.value.set(settings.flagColor);
  clothUniforms.roughness.value = settings.roughness;
  clothUniforms.sheen.value = settings.sheen;
  clothUniforms.fabricNormalStrength.value = settings.fabricNormalStrength;
  clothUniforms.fabricNormalScale.value = settings.fabricNormalScale;
  clothUniforms.fabricTiling.value = settings.fabricTiling;

  material.roughness = settings.roughness;
  material.sheen = settings.sheen;
  material.sheenRoughness = settings.sheenRoughness;
  material.sheenColor.set(settings.flagColor);
  material.transmission = 0;
}

export function setFabricPlaneDebugView(material: THREE.MeshPhysicalNodeMaterial, mode: number): void {
  const debugViewUniform = material.userData.fabricPlaneDebugView as ReturnType<typeof uniform<number>> | undefined;
  if (debugViewUniform) {
    debugViewUniform.value = mode;
  }
}
