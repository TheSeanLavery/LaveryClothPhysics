import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMultiMaterialTestAssembly,
  MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT,
  MULTI_MATERIAL_DEFAULT_PIN_TOP_Y,
  patchIdToMaterialKey,
} from '../cloth/multiMaterialTestAssembly.ts';
import {
  buildAssemblyClothTopology,
  buildAssemblySelfCollisionExclusions,
} from './clothTopology.ts';

test('assembly self-collision keeps cross-patch dangle and banner pairs active', () => {
  const assembly = createMultiMaterialTestAssembly();
  const hoistY = MULTI_MATERIAL_DEFAULT_PIN_TOP_Y + MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT;
  const topo = buildAssemblyClothTopology(assembly, {
    pinVertexYAtOrAbove: hoistY,
    resolvePatchMaterialKey: patchIdToMaterialKey,
  });

  const lowestDangleVertex = assembly.vertices.reduce((lowest, vertex) => {
    if (!vertex.patchId.includes('dangle')) {
      return lowest;
    }
    if (!lowest || vertex.position[1] < lowest.position[1]) {
      return vertex;
    }
    return lowest;
  }, null as (typeof assembly.vertices)[number] | null);
  assert.ok(lowestDangleVertex);

  const bannerMidVertex = assembly.vertices.find(
    (vertex) => vertex.patchId.startsWith('banner-') && Math.abs(vertex.position[1] - 0.175) < 0.05,
  );
  assert.ok(bannerMidVertex);

  const dangleParticle = topo.renderSurface.renderVertexToParticle![lowestDangleVertex.id]!;
  const bannerParticle = topo.renderSurface.renderVertexToParticle![bannerMidVertex.id]!;
  const exclusions = topo.selfCollisionExclusions;
  const particleCount = topo.particles.length;

  assert.equal(
    exclusions[dangleParticle * particleCount + bannerParticle],
    0,
    'dangle and banner interior should collide across patch boundaries',
  );
});

test('per-material tear threshold can be lower than the global scene tear', () => {
  const assembly = createMultiMaterialTestAssembly();
  const topo = buildAssemblyClothTopology(assembly, {
    globalTearStretchThreshold: 4,
    materialAbsoluteTearThresholdByKey: {
      'dangle-soft': 1.25,
      'dangle-stiff': 6,
      'banner-a': 4,
      'banner-b': 4,
      'banner-c': 4,
    },
    resolvePatchMaterialKey: patchIdToMaterialKey,
  });

  const dangleParticleTears = assembly.vertices
    .filter((vertex) => vertex.patchId.includes('dangle-soft'))
    .map((vertex) => topo.particles[topo.renderSurface.renderVertexToParticle![vertex.id]!]!.tearThresholdScale);
  const bannerParticleTears = assembly.vertices
    .filter((vertex) => vertex.patchId.startsWith('banner-a-'))
    .map((vertex) => topo.particles[topo.renderSurface.renderVertexToParticle![vertex.id]!]!.tearThresholdScale);

  assert.ok(dangleParticleTears.some((tear) => tear < 2));
  assert.ok(bannerParticleTears.every((tear) => tear >= 3.9));
});

test('assembly self-collision still skips immediate surface neighbors', () => {
  const assembly = createMultiMaterialTestAssembly();
  const topo = buildAssemblyClothTopology(assembly, {
    resolvePatchMaterialKey: patchIdToMaterialKey,
  });
  const exclusions = buildAssemblySelfCollisionExclusions(topo.constraints, topo.particles.length);

  let neighborExcluded = false;
  for (const constraint of topo.constraints) {
    if (constraint.kind !== 'structural' && constraint.kind !== 'shear') {
      continue;
    }
    if (exclusions[constraint.a * topo.particles.length + constraint.b] === 1) {
      neighborExcluded = true;
      break;
    }
  }

  assert.ok(neighborExcluded, 'surface neighbors remain excluded from self-collision');
});
