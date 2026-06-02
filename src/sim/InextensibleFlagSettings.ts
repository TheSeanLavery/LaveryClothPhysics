export interface InextensibleFlagSettings {
  segmentsX: number;
  segmentsY: number;
  constraintIterations: number;
  bendStiffness: number;
  minCompression: number;
  clothThickness: number;
  /** Render mesh subdivisions per sim quad (physics grid unchanged). */
  renderSubdivisions: number;
  /** 0 = linear, 1 = Catmull-Rom, 2–3 = extra surface relaxation passes. */
  renderGeometrySmoothing: number;
  flatShading: boolean;
  selfCollision: boolean;
  poleCollision: boolean;
  windStrength: number;
  windTurbulence: number;
  windDirectionX: number;
  windDirectionY: number;
  windDirectionZ: number;
  zoneAStrength: number;
  zoneARadius: number;
  zoneASpeed: number;
  zoneADirX: number;
  zoneADirY: number;
  zoneADirZ: number;
  zoneBStrength: number;
  zoneBRadius: number;
  zoneBSpeed: number;
  zoneBDirX: number;
  zoneBDirY: number;
  zoneBDirZ: number;
  dampening: number;
  /** Screen-space radius around the picked particle that follows grab dragging. */
  grabRadius: number;
  /** Fraction of the requested grab correction applied each solver tick. */
  grabStiffness: number;
  /** Maximum world-space grab correction per solver tick. */
  grabMaxStep: number;
  /** How much grab movement becomes Verlet velocity after the correction. */
  grabVelocityCarry: number;
  /** Max screen-space pointer travel consumed by grab each animation frame. */
  grabPointerMaxStep: number;
  gravity: number;
  /** Outward force for inflated garment/assembly previews (0 = off). */
  shapePressure: number;
  /** GPU procedural T-pose mannequin collision for garment fitting. */
  mannequinCollision: boolean;
  /** Draw the visual mannequin proxy that matches the GPU SDF dimensions. */
  showMannequin: boolean;
  /** Extra world-space clearance between cloth particles and the mannequin SDF. */
  mannequinMargin: number;
  /** Tangential damping applied when cloth contacts the mannequin. */
  mannequinFriction: number;
  mannequinTorsoRadiusX: number;
  mannequinTorsoRadiusY: number;
  mannequinTorsoRadiusZ: number;
  mannequinTorsoCenterY: number;
  mannequinArmRadius: number;
  mannequinArmHalfLength: number;
  mannequinArmCenterY: number;
  mannequinNeckRadius: number;
  mannequinNeckCenterY: number;
  mannequinNeckBaseRadius: number;
  mannequinNeckBaseCenterY: number;
  flagColor: string;
  roughness: number;
  sheen: number;
  sheenRoughness: number;
  emissiveIntensity: number;
  /** Blend weight for tileable weave normal detail (0 = off). */
  fabricNormalStrength: number;
  /** Intensity of the weave normal map sampling (normalMap scale). */
  fabricNormalScale: number;
  /** Weave repeats per meter in fabric UV space. */
  fabricTiling: number;
  /** Procedural runtime weave maps vs baked denim PBR set in public/textures. */
  fabricTextureSource: 'procedural' | 'denim-512';
  /** Multiplies baked albedo when fabricTextureSource is not procedural (1 = raw texture). */
  fabricColorTint: number;
  exposure: number;
  ambientIntensity: number;
  hemiIntensity: number;
  keyLightIntensity: number;
  fillLightIntensity: number;
  backLightIntensity: number;
  rimLightIntensity: number;
  /** Draw sim grid particles and highlight the vertex under the mouse pointer. */
  showSimGridDebug: boolean;
  /** Edge stretch ratio above rest length before strain tearing (1.0 = no extra stretch). */
  tearStretchThreshold: number;
  /** Sim-space width of dark fray shading near broken edges. */
  tearFringeWidth: number;
  /** Render topology generation for torn cells. */
  tearMeshing: 'edge-cull' | 'sdf';
  /** Sim-cell units for rounding fully torn cells in SDF meshing. */
  tearSdfCornerRadius: number;
  /** Highlight ultra-stretched render triangles (likely invisible strand bridges). */
  showBridgeSplinters: boolean;
  /** Draw cosmetic thread capsules on single-link sim cell connections (visual only). */
  renderStrandThreads: boolean;
  /** World-space radius of visual strand threads. */
  strandThreadRadius: number;
  /** BB projectile speed (world units / sec). */
  bbSpeed: number;
  /** Rendered BB radius (world units). */
  bbVisualRadius: number;
  /** Cloth force reach beyond the BB surface (world units). */
  bbHitRadius: number;
  /** BB impulse strength multiplier. */
  bbForceStrength: number;
  /** BB bounce restitution off cloth (0–1). */
  bbRestitution: number;
  /** BB tangential friction on cloth (0–1). */
  bbFriction: number;
  /** Soft fabric yield for cloth push and BB deflection (0 = stiff, 1 = very soft). */
  bbFabricSoftness: number;
}

export const defaultInextensibleFlagSettings = (): InextensibleFlagSettings => ({
  segmentsX: 49,
  segmentsY: 26,
  constraintIterations: 7,
  bendStiffness: 0.01,
  minCompression: 0.92,
  clothThickness: 0.015,
  renderSubdivisions: 3,
  renderGeometrySmoothing: 1.5,
  flatShading: false,
  selfCollision: true,
  poleCollision: true,
  windStrength: 2.5,
  windTurbulence: 3.75,
  windDirectionX: -0.5,
  windDirectionY: 0.51,
  windDirectionZ: 0.85,
  zoneAStrength: 1.0,
  zoneARadius: 1.1,
  zoneASpeed: 0.65,
  zoneADirX: 1,
  zoneADirY: 0.05,
  zoneADirZ: 0.25,
  zoneBStrength: 0.85,
  zoneBRadius: 0.9,
  zoneBSpeed: 0.35,
  zoneBDirX: -0.8,
  zoneBDirY: 0.08,
  zoneBDirZ: 0.35,
  dampening: 0.9925,
  grabRadius: 0.11,
  grabStiffness: 0.55,
  grabMaxStep: 0.018,
  grabVelocityCarry: 0,
  grabPointerMaxStep: 0.045,
  gravity: 0.00006,
  shapePressure: 0,
  mannequinCollision: false,
  showMannequin: false,
  mannequinMargin: 0.006,
  mannequinFriction: 0.18,
  mannequinTorsoRadiusX: 0.255,
  mannequinTorsoRadiusY: 0.42,
  mannequinTorsoRadiusZ: 0.11,
  mannequinTorsoCenterY: 0.43,
  mannequinArmRadius: 0.078,
  mannequinArmHalfLength: 0.62,
  mannequinArmCenterY: 0.65,
  mannequinNeckRadius: 0.075,
  mannequinNeckCenterY: 0.93,
  mannequinNeckBaseRadius: 0.11,
  mannequinNeckBaseCenterY: 0.82,
  flagColor: '#ffffff',
  roughness: 0.78,
  sheen: 0.42,
  sheenRoughness: 0.55,
  emissiveIntensity: 0,
  fabricNormalStrength: 0,
  fabricNormalScale: 0.45,
  fabricTiling: 6,
  fabricTextureSource: 'denim-512',
  fabricColorTint: 1,
  exposure: 1.45,
  ambientIntensity: 0.75,
  hemiIntensity: 1.1,
  keyLightIntensity: 2.0,
  fillLightIntensity: 1.35,
  backLightIntensity: 1.25,
  rimLightIntensity: 0.95,
  showSimGridDebug: false,
  tearStretchThreshold: 2.73,
  tearFringeWidth: 0.075,
  tearMeshing: 'sdf',
  tearSdfCornerRadius: 0.35,
  showBridgeSplinters: false,
  renderStrandThreads: false,
  strandThreadRadius: 0.008,
  bbSpeed: 30,
  bbVisualRadius: 0.022,
  bbHitRadius: 0.07,
  bbForceStrength: 1.2,
  bbRestitution: 0.38,
  bbFriction: 0.45,
  bbFabricSoftness: 0.58,
});
