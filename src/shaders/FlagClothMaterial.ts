import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  cross,
  directionToFaceDirection,
  float,
  max,
  min,
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
import { createSimTearShading } from './simTearShading';

export interface MatteCottonFlagMaterialOptions {
  settings: InextensibleFlagSettings;
  bakedTextures?: BakedClothTextureSet | null;
  flatShadingUniform: ReturnType<typeof uniform>;
  normalFlat: unknown;
  sampleSimPosition: ReturnType<typeof Fn>;
  normalSampleStep: ReturnType<typeof uniform>;
  gridMaxXUniform: ReturnType<typeof uniform>;
  gridMaxYUniform: ReturnType<typeof uniform>;
  edgeActiveBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  simHorizontalEdgeIdBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  simVerticalEdgeIdBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  simShearDownEdgeIdBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  simShearUpEdgeIdBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  simGridSizeYUniform?: ReturnType<typeof uniform>;
  /** Garment/assembly topology: simGridCoord.x is a particle id, not a grid axis. */
  particleSurfacePositions?: boolean;
  /** Hide torn triangles on GPU via edgeVisualBuffer + particleTriEdge* attributes. */
  particleGpuEdgeCull?: {
    edgeActiveBuffer: NonNullable<MatteCottonFlagMaterialOptions['edgeActiveBuffer']>;
  };
  clothSegmentCountUniform?: ReturnType<typeof uniform>;
  segmentScalars1Buffer?: ReturnType<typeof import('three/tsl').instancedArray>;
  segmentHealthBuffer?: ReturnType<typeof import('three/tsl').instancedArray>;
}

export interface MatteCottonFlagMaterialUniforms {
  baseColor: ReturnType<typeof uniform<THREE.Color>>;
  roughness: ReturnType<typeof uniform<number>>;
  sheen: ReturnType<typeof uniform<number>>;
  fabricNormalStrength: ReturnType<typeof uniform<number>>;
  fabricNormalScale: ReturnType<typeof uniform<number>>;
  fabricTiling: ReturnType<typeof uniform<number>>;
  fabricColorTint: ReturnType<typeof uniform<number>>;
  tearFringeWidth: ReturnType<typeof uniform<number>>;
  showBridgeSplinters: ReturnType<typeof uniform<number>>;
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
    edgeActiveBuffer,
    simHorizontalEdgeIdBuffer,
    simVerticalEdgeIdBuffer,
    simShearDownEdgeIdBuffer,
    simShearUpEdgeIdBuffer,
    simGridSizeYUniform,
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
    tearFringeWidth: uniform(settings.tearFringeWidth),
    showBridgeSplinters: uniform(settings.showBridgeSplinters ? 1 : 0),
  };

  const applyBridgeSplinterDebug = Fn(([baseColor]) => {
    const dpdx = positionWorld.dFdx().length();
    const dpdy = positionWorld.dFdy().length();
    const longEdge = max(dpdx, dpdy);
    const shortEdge = max(min(dpdx, dpdy), float(1e-6));
    const isSplinter = longEdge.div(shortEdge).greaterThan(float(10));
    const highlight = vec3(1, 0.15, 0.85);
    const active = clothUniforms.showBridgeSplinters.greaterThan(float(0)).and(isSplinter);
    return mix(baseColor, highlight, select(active, float(0.92), float(0)));
  });

  const fabricNormalTexture = getFabricNormalMapTexture();
  const sampleFabricUv = Fn(() => uv().mul(clothUniforms.fabricTiling));

  const sampleWeave = Fn(() => {
    const fabricUv = sampleFabricUv();
    const normalMap = useBakedTextures ? bakedTextures!.normal : fabricNormalTexture;
    return texture(normalMap, fabricUv);
  });

  const segmentScalars1Buffer = options.segmentScalars1Buffer;
  const segmentHealthBuffer = options.segmentHealthBuffer;
  const clothSegmentCountUniform = options.clothSegmentCountUniform;

  const sampleSegmentBaseColor = Fn(() => {
    const segId = uint(attribute('renderSegmentId').floor());
    const segColor = segmentScalars1Buffer!.element(segId).xyz;
    const health = segmentHealthBuffer!.element(segId).x.clamp(float(0.05), float(1));
    const damageTint = vec3(0.35, 0.08, 0.06);
    return mix(segColor.mul(health), damageTint, float(1).sub(health).mul(float(0.55)));
  });

  const useSegmentColors =
    segmentScalars1Buffer !== undefined &&
    segmentHealthBuffer !== undefined &&
    clothSegmentCountUniform !== undefined;

  const computeProceduralColor = Fn(() => {
    const mapSample = sampleWeave();
    const strength = clothUniforms.fabricNormalStrength;
    const baseTint = useSegmentColors
      ? select(
          clothSegmentCountUniform!.greaterThan(uint(0)),
          sampleSegmentBaseColor(),
          clothUniforms.baseColor,
        )
      : clothUniforms.baseColor;

    const warpTint = baseTint.mul(1.05);
    const weftTint = baseTint.mul(0.95);
    const warpOver = mapSample.r.greaterThan(mapSample.g);
    const macroColor = mix(weftTint, warpTint, select(warpOver, float(1), float(0)));

    const groove = float(1).sub(float(1).sub(mapSample.b).mul(0.14).mul(strength));
    const woven = max(macroColor.mul(groove), baseTint.mul(0.82));
    return mix(baseTint, woven, strength.clamp(0, 1));
  });

  const useWeaveNormals = clothUniforms.fabricNormalStrength.greaterThan(float(0.001));

  const hasSimEdgeTearing =
    !options.particleSurfacePositions &&
    edgeActiveBuffer &&
    simHorizontalEdgeIdBuffer &&
    simVerticalEdgeIdBuffer &&
    simShearDownEdgeIdBuffer &&
    simShearUpEdgeIdBuffer &&
    simGridSizeYUniform;

  const tearShading = hasSimEdgeTearing
    ? createSimTearShading({
        edgeActiveBuffer,
        simHorizontalEdgeIdBuffer,
        simVerticalEdgeIdBuffer,
        simShearDownEdgeIdBuffer,
        simShearUpEdgeIdBuffer,
        simGridSizeYUniform,
        gridMaxXUniform,
        gridMaxYUniform,
        tearFringeWidthUniform: clothUniforms.tearFringeWidth,
      })
    : null;

  const tearMinDistanceVarying = tearShading ? varyingProperty('float', 'vTearMinDist') : null;
  const particleSurface = options.particleSurfacePositions === true;
  const particleEdgeCullBuffer = options.particleGpuEdgeCull?.edgeActiveBuffer;

  /** Fragment-only: vertex stage is limited to one storage buffer (vertex positions). */
  const particleTriangleOpacity = particleEdgeCullBuffer
    ? Fn(() => {
        const e0 = attribute('particleTriEdge0');
        const e1 = attribute('particleTriEdge1');
        const e2 = attribute('particleTriEdge2');
        const broken0 = e0
          .greaterThanEqual(float(0))
          .and(particleEdgeCullBuffer.element(uint(e0)).equal(uint(0)));
        const broken1 = e1
          .greaterThanEqual(float(0))
          .and(particleEdgeCullBuffer.element(uint(e1)).equal(uint(0)));
        const broken2 = e2
          .greaterThanEqual(float(0))
          .and(particleEdgeCullBuffer.element(uint(e2)).equal(uint(0)));
        const intact = broken0.not().and(broken1.not()).and(broken2.not());
        return select(intact, float(1), float(0));
      })()
    : null;

  const applyParticleEdgeMask = (colorNode: unknown) => {
    if (!particleTriangleOpacity) {
      return colorNode;
    }
    if (material) {
      material.opacityNode = particleTriangleOpacity;
      material.transparent = true;
      material.alphaTest = 0.5;
      material.depthWrite = true;
    }
    return colorNode;
  };

  // One neighbor sample pass per vertex: position, world normal, fly tangent, view normal.
  const emitSurfaceVaryings = Fn(() => {
    const simCoord = attribute('simGridCoord');
    const simGridX = simCoord.x;
    const simGridY = simCoord.y;

    if (particleSurface) {
      const posC = sampleSimPosition(simGridX);
      const facetNormal = cross(positionView.dFdx(), positionView.dFdy()).normalize();
      const flyTangentRaw = positionView.dFdx().normalize();
      const flyBitangentRaw = positionView.dFdy();
      const flyNormal = cross(flyTangentRaw, flyBitangentRaw)
        .div(cross(flyTangentRaw, flyBitangentRaw).length().max(1e-4))
        .normalize();
      const flyTangent = flyTangentRaw.sub(flyNormal.mul(flyNormal.dot(flyTangentRaw))).normalize();

      facetNormal.toVarying('vFlagNormal');
      flyTangent.toVarying('vFabricTangent');
      transformNormalToView(facetNormal).normalize().toVarying('vFlagNormalViewSmoothed');

      return posC;
    }

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
    const worldNormal = select(normalLen.lessThan(1e-3), wideNormal, stableNormal);

    const flyTangentRaw = select(
      atMinX,
      posR.sub(posC).mul(2),
      select(atMaxX, posC.sub(posL).mul(2), posR.sub(posL)),
    );
    const flyBitangentRaw = posD.sub(posU);
    const flyNormal = cross(flyTangentRaw, flyBitangentRaw)
      .div(cross(flyTangentRaw, flyBitangentRaw).length().max(1e-4))
      .normalize();
    const flyTangent = flyTangentRaw.sub(flyNormal.mul(flyNormal.dot(flyTangentRaw))).normalize();

    worldNormal.toVarying('vFlagNormal');
    flyTangent.toVarying('vFabricTangent');
    transformNormalToView(worldNormal).normalize().toVarying('vFlagNormalViewSmoothed');

    if (tearShading) {
      tearShading.computeTearMinDistance().toVarying('vTearMinDist');
    }

    return posC;
  });

  const smoothNormalView = varyingProperty('vec3', 'vFlagNormalViewSmoothed');

  // Facet normals are already face-correct; only flip the smooth vertex normal for DoubleSide.
  const computeStableFlagNormalView = Fn(() => {
    const facet = positionView.dFdx().cross(positionView.dFdy()).normalize();
    const smoothCorrected = directionToFaceDirection(smoothNormalView);
    const alignment = smoothCorrected.dot(facet).abs();
    return mix(facet, smoothCorrected, alignment.mul(0.45).add(0.3)).normalize();
  });

  const applyFabricNormalMap = createApplyFabricNormalMapFn(
    sampleWeave,
    clothUniforms,
    varyingProperty('vec3', 'vFlagNormal'),
    varyingProperty('vec3', 'vFabricTangent'),
    { fromWorldSpace: true },
  );

  const shadeWithTears = (baseColor: ReturnType<typeof Fn>, baseRoughness?: ReturnType<typeof Fn>) => {
    if (!tearShading || !tearMinDistanceVarying) {
      return { colorNode: baseColor(), roughnessOverride: baseRoughness?.() };
    }

    return {
      colorNode: tearShading.applyTearColorFromMinDistance(baseColor(), tearMinDistanceVarying),
      roughnessOverride: baseRoughness
        ? tearShading.applyTearRoughnessFromMinDistance(baseRoughness(), tearMinDistanceVarying)
        : undefined,
    };
  };

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
    const bakedRoughness = Fn(() =>
      bakedRoughnessSample().mul(clothUniforms.roughness).clamp(0.15, 0.9),
    );
    const tornBaked = shadeWithTears(bakedColor, bakedRoughness);

    material.colorNode = applyParticleEdgeMask(applyBridgeSplinterDebug(tornBaked.colorNode));
    material.roughnessNode = tornBaked.roughnessOverride ?? bakedRoughness();
    material.color.set(0xffffff);
  } else {
    const proceduralRoughness = Fn(() => {
      const microRoughness = triNoise3D(positionWorld.mul(90), 1, float(0)).x;
      return mix(
        clothUniforms.roughness.mul(0.94),
        clothUniforms.roughness.mul(1.06),
        microRoughness,
      );
    });
    const tornProcedural = shadeWithTears(computeProceduralColor, proceduralRoughness);

    material.colorNode = applyParticleEdgeMask(applyBridgeSplinterDebug(tornProcedural.colorNode));
    material.roughnessNode = tornProcedural.roughnessOverride ?? proceduralRoughness();
  }

  material.positionNode = emitSurfaceVaryings();

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
  clothUniforms.tearFringeWidth.value = settings.tearFringeWidth;
  clothUniforms.showBridgeSplinters.value = settings.showBridgeSplinters ? 1 : 0;

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
