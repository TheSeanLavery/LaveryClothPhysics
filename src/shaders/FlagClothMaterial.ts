import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  cross,
  directionToFaceDirection,
  float,
  max,
  mix,
  normalFlat,
  positionView,
  positionWorld,
  select,
  texture,
  transformNormalToView,
  triNoise3D,
  uniform,
  uint,
  uv,
  varyingProperty,
  vec3,
} from 'three/tsl';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings';
import { getFabricNormalMapTexture } from '../textures/createFabricNormalMap';
import type { BakedClothTextureSet } from '../textures/loadBakedClothTextures';
import { createApplyFabricNormalMapFn } from './fabricNormalDetail';

export interface MatteCottonFlagMaterialOptions {
  settings: InextensibleFlagSettings;
  bakedTextures?: BakedClothTextureSet | null;
  flatShadingUniform: ReturnType<typeof uniform>;
  normalFlat: unknown;
  sampleSimPosition: ReturnType<typeof Fn>;
  normalSampleStep: ReturnType<typeof uniform>;
  gridMaxXUniform: ReturnType<typeof uniform>;
  gridMaxYUniform: ReturnType<typeof uniform>;
}

export interface MatteCottonFlagMaterialUniforms {
  baseColor: ReturnType<typeof uniform<THREE.Color>>;
  roughness: ReturnType<typeof uniform<number>>;
  sheen: ReturnType<typeof uniform<number>>;
  fabricNormalStrength: ReturnType<typeof uniform<number>>;
  fabricNormalScale: ReturnType<typeof uniform<number>>;
  fabricTiling: ReturnType<typeof uniform<number>>;
  fabricColorTint: ReturnType<typeof uniform<number>>;
}

export function configureMatteCottonFlagMaterial(
  material: THREE.MeshPhysicalNodeMaterial,
  options: MatteCottonFlagMaterialOptions,
): void {
  const {
    settings,
    bakedTextures,
    flatShadingUniform,
    normalFlat,
    sampleSimPosition,
    normalSampleStep,
    gridMaxXUniform,
    gridMaxYUniform,
  } = options;

  const useBakedTextures =
    settings.fabricTextureSource === 'denim-512' && bakedTextures !== null && bakedTextures !== undefined;

  const clothUniforms: MatteCottonFlagMaterialUniforms = {
    baseColor: uniform(new THREE.Color(settings.flagColor)),
    roughness: uniform(settings.roughness),
    sheen: uniform(settings.sheen),
    fabricNormalStrength: uniform(settings.fabricNormalStrength),
    fabricNormalScale: uniform(settings.fabricNormalScale),
    fabricTiling: uniform(settings.fabricTiling),
    fabricColorTint: uniform(settings.fabricColorTint),
  };

  const fabricNormalTexture = getFabricNormalMapTexture();
  const sampleFabricUv = Fn(() => uv().mul(clothUniforms.fabricTiling));

  const sampleWeave = Fn(() => {
    const fabricUv = sampleFabricUv();
    const normalMap = useBakedTextures ? bakedTextures!.normal : fabricNormalTexture;
    return texture(normalMap, fabricUv);
  });

  const computeProceduralColor = Fn(() => {
    const mapSample = sampleWeave();
    const strength = clothUniforms.fabricNormalStrength;

    const warpTint = clothUniforms.baseColor.mul(1.05);
    const weftTint = clothUniforms.baseColor.mul(0.95);
    const warpOver = mapSample.r.greaterThan(mapSample.g);
    const macroColor = mix(weftTint, warpTint, select(warpOver, float(1), float(0)));

    const groove = float(1).sub(float(1).sub(mapSample.b).mul(0.14).mul(strength));
    const woven = max(macroColor.mul(groove), clothUniforms.baseColor.mul(0.82));
    return mix(clothUniforms.baseColor, woven, strength.clamp(0, 1));
  });

  const computeRenderWorldNormal = Fn(() => {
    const simCoord = attribute('simGridCoord');
    const simGridX = simCoord.x;
    const simGridY = simCoord.y;
    const step = normalSampleStep;
    const maxX = float(gridMaxXUniform);
    const maxY = float(gridMaxYUniform);

    const posC = sampleSimPosition(simGridX, simGridY);
    const posL = sampleSimPosition(simGridX.sub(step).clamp(0, maxX), simGridY);
    const posR = sampleSimPosition(simGridX.add(step).clamp(0, maxX), simGridY);
    const posU = sampleSimPosition(simGridX, simGridY.sub(step).clamp(0, maxY));
    const posD = sampleSimPosition(simGridX, simGridY.add(step).clamp(0, maxY));

    const atMinX = simGridX.lessThan(step.mul(0.51));
    const atMaxX = simGridX.greaterThan(maxX.sub(step.mul(0.51)));
    const atMinY = simGridY.lessThan(step.mul(0.51));
    const atMaxY = simGridY.greaterThan(maxY.sub(step.mul(0.51)));

    const tangentRaw = select(
      atMinX,
      posR.sub(posC).mul(2),
      select(atMaxX, posC.sub(posL).mul(2), posR.sub(posL)),
    );
    const bitangentRaw = select(
      atMinY,
      posD.sub(posC).mul(2),
      select(atMaxY, posC.sub(posU).mul(2), posD.sub(posU)),
    );
    const normalRaw = cross(tangentRaw, bitangentRaw);
    const normalLen = normalRaw.length();
    const stableNormal = normalRaw.div(normalLen.max(1e-4)).normalize();

    const wideStep = step.mul(2);
    const posLw = sampleSimPosition(simGridX.sub(wideStep).clamp(0, maxX), simGridY);
    const posRw = sampleSimPosition(simGridX.add(wideStep).clamp(0, maxX), simGridY);
    const posUw = sampleSimPosition(simGridX, simGridY.sub(wideStep).clamp(0, maxY));
    const posDw = sampleSimPosition(simGridX, simGridY.add(wideStep).clamp(0, maxY));
    const wideNormal = cross(posRw.sub(posLw), posDw.sub(posUw)).normalize();

    return select(normalLen.lessThan(1e-3), wideNormal, stableNormal);
  });

  const computeRenderWorldFlyTangent = Fn(() => {
    const simCoord = attribute('simGridCoord');
    const simGridX = simCoord.x;
    const simGridY = simCoord.y;
    const step = normalSampleStep;
    const maxX = float(gridMaxXUniform);
    const maxY = float(gridMaxYUniform);

    const posC = sampleSimPosition(simGridX, simGridY);
    const posL = sampleSimPosition(simGridX.sub(step).clamp(0, maxX), simGridY);
    const posR = sampleSimPosition(simGridX.add(step).clamp(0, maxX), simGridY);
    const posU = sampleSimPosition(simGridX, simGridY.sub(step).clamp(0, maxY));
    const posD = sampleSimPosition(simGridX, simGridY.add(step).clamp(0, maxY));

    const atMinX = simGridX.lessThan(step.mul(0.51));
    const atMaxX = simGridX.greaterThan(maxX.sub(step.mul(0.51)));

    const tangentRaw = select(atMinX, posR.sub(posC).mul(2), select(atMaxX, posC.sub(posL).mul(2), posR.sub(posL)));
    const bitangentRaw = posD.sub(posU);
    const normal = cross(tangentRaw, bitangentRaw).div(cross(tangentRaw, bitangentRaw).length().max(1e-4)).normalize();

    return tangentRaw.sub(normal.mul(normal.dot(tangentRaw))).normalize();
  });

  const computeRenderNormalView = Fn(() => transformNormalToView(computeRenderWorldNormal()).normalize());

  const smoothNormalView = computeRenderNormalView().toVarying('vFlagNormalViewSmoothed');

  // Blend sim normals with per-triangle facet normals; directionToFaceDirection lights both DoubleSide faces.
  const computeStableFlagNormalView = Fn(() => {
    const facet = positionView.dFdx().cross(positionView.dFdy()).normalize();
    const smooth = smoothNormalView;
    const alignment = smooth.dot(facet).abs();
    const blended = mix(facet, smooth, alignment.mul(0.45).add(0.3)).normalize();
    return directionToFaceDirection(blended);
  });

  const applyFabricNormalMap = createApplyFabricNormalMapFn(
    sampleWeave,
    clothUniforms,
    varyingProperty('vec3', 'vFlagNormal'),
    varyingProperty('vec3', 'vFabricTangent'),
    { fromWorldSpace: true },
  );

  const useWeaveNormals = clothUniforms.fabricNormalStrength.greaterThan(float(0.001));

  material.userData.matteCottonUniforms = clothUniforms;
  material.transparent = false;
  material.transmission = 0;
  material.thickness = 0;
  material.ior = 1.5;
  material.sheenRoughness = settings.sheenRoughness;
  material.sheenColor = new THREE.Color(settings.flagColor);
  material.envMapIntensity = 1.15;

  if (useBakedTextures) {
    bakedTextures!.albedo.colorSpace = THREE.SRGBColorSpace;
    bakedTextures!.albedo.wrapS = THREE.RepeatWrapping;
    bakedTextures!.albedo.wrapT = THREE.RepeatWrapping;

    bakedTextures!.roughness.wrapS = THREE.RepeatWrapping;
    bakedTextures!.roughness.wrapT = THREE.RepeatWrapping;

    const bakedColor = Fn(() => texture(bakedTextures!.albedo, sampleFabricUv()).rgb);
    const bakedRoughnessSample = Fn(() => texture(bakedTextures!.roughness, sampleFabricUv()).r);

    material.colorNode = bakedColor();
    material.roughnessNode = bakedRoughnessSample().mul(clothUniforms.roughness).clamp(0.15, 0.9);
    material.color.set(0xffffff);
  } else {
    material.colorNode = computeProceduralColor();
    const microRoughness = triNoise3D(positionWorld.mul(90), 1, float(0)).x;
    material.roughnessNode = mix(
      clothUniforms.roughness.mul(0.94),
      clothUniforms.roughness.mul(1.06),
      microRoughness,
    );
  }

  material.positionNode = Fn(() => {
    computeRenderWorldNormal().toVarying('vFlagNormal');
    computeRenderWorldFlyTangent().toVarying('vFabricTangent');
    const simCoord = attribute('simGridCoord');
    return sampleSimPosition(simCoord.x, simCoord.y);
  })();

  material.normalNode = select(
    flatShadingUniform.equal(uint(1)),
    normalFlat,
    useBakedTextures
      ? computeStableFlagNormalView()
      : select(useWeaveNormals, applyFabricNormalMap(), computeStableFlagNormalView()),
  );
}

export function updateMatteCottonFlagMaterial(
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
  clothUniforms.fabricColorTint.value = settings.fabricColorTint;

  material.roughness = settings.roughness;
  material.sheen = settings.sheen;
  material.sheenRoughness = settings.sheenRoughness;
  material.sheenColor.set(settings.flagColor);
  material.transmission = 0;

  if (material.map) {
    material.map = null;
  }
  if (material.roughnessMap) {
    material.roughnessMap = null;
  }
}
