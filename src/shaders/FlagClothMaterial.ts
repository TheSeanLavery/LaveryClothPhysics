import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  cross,
  directionToFaceDirection,
  float,
  floor,
  max,
  mix,
  mod,
  positionWorld,
  select,
  smoothstep,
  transformNormalToView,
  uniform,
  uint,
  varyingProperty,
} from 'three/tsl';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings';

export interface FlagClothMaterialOptions {
  settings: InextensibleFlagSettings;
  vertexPositionBuffer: ReturnType<typeof import('three/tsl').instancedArray>;
  vertexGridBuffer: ReturnType<typeof import('three/tsl').instancedArray>;
  gridSizeX: number;
  gridSizeY: number;
}

export interface FlagClothMaterialUniforms {
  baseColor: ReturnType<typeof uniform<THREE.Color>>;
  roughness: ReturnType<typeof uniform<number>>;
  sheen: ReturnType<typeof uniform<number>>;
}

/**
 * Grid-based cloth shading. Normals come from simulation neighbor positions so
 * folds stay lit correctly instead of going black at quad-center mesh creases.
 */
export function createFlagClothMaterial(
  options: FlagClothMaterialOptions,
): THREE.MeshPhysicalNodeMaterial {
  const {
    settings,
    vertexPositionBuffer,
    vertexGridBuffer,
    gridSizeX,
    gridSizeY,
  } = options;

  const clothUniforms: FlagClothMaterialUniforms = {
    baseColor: uniform(new THREE.Color(settings.flagColor)),
    roughness: uniform(settings.roughness),
    sheen: uniform(settings.sheen),
  };

  const gridStrideY = uniform(gridSizeY);
  const gridMaxX = uniform(gridSizeX - 1);
  const gridMaxY = uniform(gridSizeY - 1);
  const threadsPerMeterU = uniform(96);
  const threadsPerMeterV = uniform(56);
  const detailNear = uniform(0.45);
  const detailFar = uniform(3.5);
  const grooveStrength = uniform(0.08);
  const minEmissive = uniform(Math.max(settings.emissiveIntensity, 0.28));

  const gridIndex = Fn(([gridX, gridY]) => gridX.mul(gridStrideY).add(gridY));

  const computeFlagNormal = Fn(() => {
    const vertexId = attribute('vertexId');
    const grid = vertexGridBuffer.element(vertexId);
    const gridX = grid.x;
    const gridY = grid.y;

    const posC = vertexPositionBuffer.element(vertexId);
    const hasLeft = gridX.greaterThan(uint(0));
    const hasRight = gridX.lessThan(gridMaxX);
    const hasUp = gridY.greaterThan(uint(0));
    const hasDown = gridY.lessThan(gridMaxY);

    const posL = select(hasLeft, vertexPositionBuffer.element(gridIndex(gridX.sub(1), gridY)), posC);
    const posR = select(hasRight, vertexPositionBuffer.element(gridIndex(gridX.add(1), gridY)), posC);
    const posU = select(hasUp, vertexPositionBuffer.element(gridIndex(gridX, gridY.sub(1))), posC);
    const posD = select(hasDown, vertexPositionBuffer.element(gridIndex(gridX, gridY.add(1))), posC);

    const tangent = posR.sub(posL);
    const bitangent = posD.sub(posU);
    const normal = cross(tangent, bitangent);
    const safeNormal = normal.div(normal.length().max(1e-4)).normalize();

    return transformNormalToView(safeNormal);
  });

  const computeDetail = Fn(() => {
    const dist = cameraPosition.distance(positionWorld);
    return smoothstep(detailFar, detailNear, dist);
  });

  const computeWeaveColor = Fn(() => {
    const weaveUv = varyingProperty('vec2', 'vWeaveUv');
    const detail = computeDetail();

    const threadU = weaveUv.x.mul(threadsPerMeterU);
    const threadV = weaveUv.y.mul(threadsPerMeterV);
    const fu = mod(threadU, float(1));
    const fv = mod(threadV, float(1));
    const uCell = floor(threadU);
    const vCell = floor(threadV);
    const warpOver = mod(uCell.add(vCell), float(2)).lessThan(float(1));

    const warpTint = clothUniforms.baseColor.mul(1.04);
    const weftTint = clothUniforms.baseColor.mul(0.96);
    const macroColor = mix(weftTint, warpTint, select(warpOver, float(1), float(0)));

    const edgeU = fu.mul(float(1).sub(fu)).mul(4.0);
    const edgeV = fv.mul(float(1).sub(fv)).mul(4.0);
    const threadEdge = edgeU.max(edgeV);
    const groove = float(1).sub(threadEdge.mul(grooveStrength).mul(detail));

    const shaded = macroColor.mul(groove);
    const floorColor = clothUniforms.baseColor.mul(0.78);

    return max(shaded, floorColor);
  });

  const clothMaterial = new THREE.MeshPhysicalNodeMaterial({
    color: new THREE.Color(settings.flagColor),
    side: THREE.DoubleSide,
    roughness: settings.roughness,
    sheen: settings.sheen,
    sheenRoughness: settings.sheenRoughness,
    sheenColor: new THREE.Color(settings.flagColor),
    emissive: new THREE.Color(settings.flagColor),
    emissiveIntensity: settings.emissiveIntensity,
    envMapIntensity: 1.2,
  });

  clothMaterial.userData.flagClothUniforms = clothUniforms;

  clothMaterial.positionNode = Fn(() => {
    attribute('weaveUv').toVarying('vWeaveUv');
    return vertexPositionBuffer.element(attribute('vertexId'));
  })();

  clothMaterial.colorNode = computeWeaveColor();
  clothMaterial.emissiveNode = clothUniforms.baseColor.mul(minEmissive);
  clothMaterial.normalNode = directionToFaceDirection(computeFlagNormal().toVarying('vFlagNormal'));

  return clothMaterial;
}

export function updateFlagClothMaterial(
  material: THREE.MeshPhysicalNodeMaterial,
  settings: InextensibleFlagSettings,
): void {
  const clothUniforms = material.userData.flagClothUniforms as FlagClothMaterialUniforms | undefined;
  if (!clothUniforms) {
    return;
  }

  clothUniforms.baseColor.value.set(settings.flagColor);
  clothUniforms.roughness.value = settings.roughness;
  clothUniforms.sheen.value = settings.sheen;
}
