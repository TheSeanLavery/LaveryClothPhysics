import * as THREE from 'three/webgpu';
import { analyzeFabricNormalMapBytes, type FabricNormalMapStats } from './fabricNormalMapAnalysis';
import { generateClothMaps, defaultClothGeneratorOptions } from './clothGenerator';

export type { FabricNormalMapStats };

let sharedFabricNormalMap: THREE.DataTexture | null = null;

function createFabricNormalMapTexture(size = 256): THREE.DataTexture {
  const options = defaultClothGeneratorOptions('plain');
  const maps = generateClothMaps({ ...options, size });
  const data = maps.normal;

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}

export function getFabricNormalMapTexture(): THREE.DataTexture {
  if (!sharedFabricNormalMap) {
    sharedFabricNormalMap = createFabricNormalMapTexture();
  }

  return sharedFabricNormalMap;
}

export function getFabricNormalMapStatsForTest(): FabricNormalMapStats {
  const options = defaultClothGeneratorOptions('plain');
  const maps = generateClothMaps({ ...options, size: 256 });
  return analyzeFabricNormalMapBytes(maps.normal, maps.size);
}
