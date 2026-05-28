import * as THREE from 'three/webgpu';

export interface BakedClothTextureSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
}

const DENIM_512_BASE = '/textures/denim-512';

function loadTexture(
  loader: THREE.TextureLoader,
  url: string,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function configureTileableTexture(texture: THREE.Texture, colorSpace: THREE.ColorSpace): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

export async function loadDenim512ClothTextures(): Promise<BakedClothTextureSet> {
  const loader = new THREE.TextureLoader();
  const [albedo, normal, roughness, height] = await Promise.all([
    loadTexture(loader, `${DENIM_512_BASE}/albedo.png`),
    loadTexture(loader, `${DENIM_512_BASE}/normal.png`),
    loadTexture(loader, `${DENIM_512_BASE}/roughness.png`),
    loadTexture(loader, `${DENIM_512_BASE}/height.png`),
  ]);

  configureTileableTexture(albedo, THREE.SRGBColorSpace);
  configureTileableTexture(normal, THREE.NoColorSpace);
  configureTileableTexture(roughness, THREE.NoColorSpace);
  configureTileableTexture(height, THREE.NoColorSpace);

  return { albedo, normal, roughness, height };
}
