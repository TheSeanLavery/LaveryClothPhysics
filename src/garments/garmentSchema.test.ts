import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClothAssembly } from '../cloth/patternAssembly.ts';
import {
  CURRENT_GARMENT_SCHEMA_VERSION,
  GARMENT_PRESET_KIND,
  createGarmentPresetEnvelope,
  normalizeGarmentParams,
  upgradeGarmentPreset,
} from './garmentSchema.ts';
import {
  generateGarmentAssembly,
  measurePleatedSkirtMaterial,
  summarizeGarmentAssembly,
} from './garmentGenerator.ts';

test('upgrades v1 garment presets into the current envelope', () => {
  const upgraded = upgradeGarmentPreset({
    kind: GARMENT_PRESET_KIND,
    schemaVersion: 1,
    id: 'legacy-shirt',
    name: 'Legacy shirt',
    garmentType: 'tshirt',
    createdAt: 100,
    params: {
      bodyWidth: 3,
      sleeveLength: 0.3,
      bodySegmentsX: 99,
    },
  });

  assert.equal(upgraded.schemaVersion, CURRENT_GARMENT_SCHEMA_VERSION);
  assert.equal(upgraded.id, 'legacy-shirt');
  assert.equal(upgraded.name, 'Legacy shirt');
  assert.equal(upgraded.garmentType, 'tshirt');
  assert.equal(upgraded.params.garmentType, 'tshirt');
  assert.equal(upgraded.params.bodyWidth, 1.2);
  assert.equal(upgraded.params.bodySegmentsX, 36);
});

test('upgrades v2 pleated skirt presets with real fold and grid defaults', () => {
  const upgraded = upgradeGarmentPreset({
    kind: GARMENT_PRESET_KIND,
    schemaVersion: 2,
    id: 'legacy-pleated',
    name: 'Legacy pleated skirt',
    garmentType: 'pleatedSkirt',
    createdAt: 100,
    params: {
      waistRadius: 0.3,
      hemRadius: 0.5,
      length: 0.7,
      panelCount: 16,
      segmentsHeight: 18,
      pleatDepth: 0.06,
      pleatCount: 14,
    },
  });

  assert.equal(upgraded.schemaVersion, CURRENT_GARMENT_SCHEMA_VERSION);
  assert.equal(upgraded.garmentType, 'pleatedSkirt');
  assert.equal(upgraded.params.garmentType, 'pleatedSkirt');
  assert.equal(upgraded.params.pleatType, 'knife');
  assert.equal(upgraded.params.hemPleatRelease, 0.55);
  assert.equal(upgraded.params.gridSpacing, 0.04);
});

test('normalizes skirt and pleated skirt parameters independently', () => {
  const skirt = normalizeGarmentParams('skirt', {
    garmentType: 'skirt',
    waistRadius: 0.01,
    hemRadius: 2,
    panelCount: 99,
  });
  assert.equal(skirt.waistRadius, 0.12);
  assert.equal(skirt.hemRadius, 1.1);
  assert.equal(skirt.panelCount, 36);
  assert.equal(skirt.gridSpacing, 0.04);

  const pleated = normalizeGarmentParams('pleatedSkirt', {
    garmentType: 'pleatedSkirt',
    gridSpacing: 0.005,
    pleatType: 'box',
    pleatDepth: 0.5,
    pleatCount: 2,
    hemPleatRelease: 2,
  });
  assert.equal(pleated.pleatDepth, 0.18);
  assert.equal(pleated.pleatCount, 4);
  assert.equal(pleated.pleatType, 'box');
  assert.equal(pleated.hemPleatRelease, 1);
  assert.equal(pleated.gridSpacing, 0.018);
});

test('generates valid assemblies for supported garment types', () => {
  for (const garmentType of ['tshirt', 'skirt', 'pleatedSkirt', 'elasticShorts', 'trousers', 'jeans'] as const) {
    const preset = createGarmentPresetEnvelope(`Test ${garmentType}`, garmentType, undefined);
    const assembly = generateGarmentAssembly(preset.params);
    const stats = summarizeGarmentAssembly(garmentType, assembly);

    assert.equal(validateClothAssembly(assembly).length, 0);
    assert.equal(stats.validationIssueCount, 0);
    assert.ok(stats.vertexCount > 0);
    assert.ok(stats.faceCount > 0);
    assert.ok(stats.stitchEdgeCount > 0);
  }
});

test('generated garments derive panel subdivisions from shared grid spacing', () => {
  for (const garmentType of ['tshirt', 'skirt', 'pleatedSkirt', 'elasticShorts', 'trousers', 'jeans'] as const) {
    const params = normalizeGarmentParams(garmentType, {
      garmentType,
      gridSpacing: 0.035,
    } as never);
    const assembly = generateGarmentAssembly(params);
    const maxEdgeLength = maxStructuralRestLength(assembly);

    assert.ok(
      maxEdgeLength <= params.gridSpacing * 1.85,
      `${garmentType} max structural edge ${maxEdgeLength.toFixed(4)} exceeds grid spacing ${params.gridSpacing}`,
    );
  }
});

test('lower body generators include realistic construction pieces', () => {
  const elasticShorts = generateGarmentAssembly(normalizeGarmentParams('elasticShorts', {
    garmentType: 'elasticShorts',
  }));
  assertPatch(elasticShorts, 'front-left-leg');
  assertPatch(elasticShorts, 'back-right-leg');
  assert.ok(elasticShorts.vertices.some((vertex) => vertex.patchId.includes('elastic-casing')));
  assert.ok(elasticShorts.stitchEdges.some((edge) => edge.sourceId.includes('inseam')));
  assert.ok(elasticShorts.stitchEdges.some((edge) => edge.sourceId.includes('crotch')));

  const trousers = generateGarmentAssembly(normalizeGarmentParams('trousers', {
    garmentType: 'trousers',
  }));
  assertPatch(trousers, 'front-left-leg-fly-facing');
  assertPatch(trousers, 'front-right-leg-fly-shield');
  assert.ok(trousers.vertices.some((vertex) => vertex.patchId.includes('waistband')));

  const jeans = generateGarmentAssembly(normalizeGarmentParams('jeans', {
    garmentType: 'jeans',
  }));
  assertPatch(jeans, 'jeans-left-back-yoke');
  assertPatch(jeans, 'jeans-right-back-pocket');
  assertPatch(jeans, 'jeans-left-front-pocket-bag');
  assertPatch(jeans, 'jeans-belt-loop-1');
});

test('lower body stitches start near their sewn positions to avoid solver explosions', () => {
  for (const garmentType of ['elasticShorts', 'trousers', 'jeans'] as const) {
    const params = normalizeGarmentParams(garmentType, { garmentType });
    const assembly = generateGarmentAssembly(params);
    const maxStitchDistance = maxInitialStitchDistance(assembly);

    assert.ok(
      maxStitchDistance <= params.gridSpacing * 0.65,
      `${garmentType} has unsafe initial stitch distance ${maxStitchDistance.toFixed(4)}`,
    );
  }
});

test('pleated skirt uses real hidden material length instead of radius-only waves', () => {
  const params = normalizeGarmentParams('pleatedSkirt', {
    garmentType: 'pleatedSkirt',
    waistRadius: 0.28,
    hemRadius: 0.44,
    length: 0.7,
    pleatType: 'knife',
    pleatDepth: 0.055,
    pleatCount: 12,
    gridSpacing: 0.04,
  });
  const assembly = generateGarmentAssembly(params);
  const material = measurePleatedSkirtMaterial(params);
  const measuredTopPath = measureTopBoundaryPath(assembly);

  assert.equal(validateClothAssembly(assembly).length, 0);
  assert.ok(material.flatWaistMaterialLength > material.finishedWaistCircumference);
  assert.ok(material.materialFullnessRatio > 1.6);
  assert.ok(measuredTopPath > material.finishedWaistCircumference + material.hiddenFoldLength * 0.95);
  assert.ok(measuredTopPath < material.flatWaistMaterialLength * 1.01);
});

function measureTopBoundaryPath(
  assembly: ReturnType<typeof generateGarmentAssembly>,
): number {
  const maxY = Math.max(...assembly.vertices.map((vertex) => vertex.position[1]));
  const topVertices = assembly.vertices
    .filter((vertex) => vertex.patchId === 'pleated-skirt-folded-panel' && Math.abs(vertex.position[1] - maxY) < 1e-6)
    .sort((a, b) => a.localId - b.localId);

  let length = 0;
  for (let i = 1; i < topVertices.length; i++) {
    const a = topVertices[i - 1]!.position;
    const b = topVertices[i]!.position;
    length += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return length;
}

function maxStructuralRestLength(assembly: ReturnType<typeof generateGarmentAssembly>): number {
  return Math.max(
    ...assembly.edges
      .filter((edge) => edge.kind === 'structural')
      .map((edge) => edge.restLength),
  );
}

function assertPatch(assembly: ReturnType<typeof generateGarmentAssembly>, patchId: string): void {
  assert.ok(
    assembly.vertices.some((vertex) => vertex.patchId === patchId),
    `Missing generated patch ${patchId}`,
  );
}

function maxInitialStitchDistance(assembly: ReturnType<typeof generateGarmentAssembly>): number {
  return Math.max(
    ...assembly.stitchEdges.map((edge) => {
      const a = assembly.vertices[edge.a]!.position;
      const b = assembly.vertices[edge.b]!.position;
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }),
  );
}
