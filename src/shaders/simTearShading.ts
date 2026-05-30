import {
  Fn,
  If,
  abs,
  attribute,
  float,
  min,
  mix,
  select,
  uint,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';

type UintBuffer = {
  element: (index: ShaderNodeObject<unknown>) => ShaderNodeObject<number>;
};

export interface SimTearShadingOptions {
  edgeActiveBuffer: UintBuffer;
  simHorizontalEdgeIdBuffer: UintBuffer;
  simVerticalEdgeIdBuffer: UintBuffer;
  simShearDownEdgeIdBuffer: UintBuffer;
  simShearUpEdgeIdBuffer: UintBuffer;
  simGridSizeYUniform: ReturnType<typeof import('three/tsl').uniform>;
  gridMaxXUniform: ReturnType<typeof import('three/tsl').uniform>;
  gridMaxYUniform: ReturnType<typeof import('three/tsl').uniform>;
  tearFringeWidthUniform: ReturnType<typeof import('three/tsl').uniform>;
}

export interface SimTearShadingResult {
  computeTearMinDistance: ReturnType<typeof Fn>;
  applyTearColorFromMinDistance: ReturnType<typeof Fn>;
  applyTearRoughnessFromMinDistance: ReturnType<typeof Fn>;
}

export function createSimTearShading(options: SimTearShadingOptions): SimTearShadingResult {
  const {
    edgeActiveBuffer,
    simHorizontalEdgeIdBuffer,
    simVerticalEdgeIdBuffer,
    simShearDownEdgeIdBuffer,
    simShearUpEdgeIdBuffer,
    simGridSizeYUniform,
    gridMaxXUniform,
    gridMaxYUniform,
    tearFringeWidthUniform,
  } = options;

  const invalidEdgeId = uint(0xffffffff);
  const maxGridX = uint(gridMaxXUniform);
  const maxGridY = uint(gridMaxYUniform);

  const isEdgeBroken = Fn(([edgeId]) =>
    edgeId.notEqual(invalidEdgeId).and(edgeActiveBuffer.element(edgeId).equal(uint(0))),
  );

  const computeTearMinDistance = Fn(() => {
    const simCoord = attribute('simGridCoord');
    const cellX = simCoord.x.floor();
    const cellY = simCoord.y.floor();
    const fracX = simCoord.x.sub(cellX);
    const fracY = simCoord.y.sub(cellY);
    const gx = uint(cellX);
    const gy = uint(cellY);
    const gridOffset = gx.mul(simGridSizeYUniform).add(gy);
    const gridOffsetRight = gx.add(uint(1)).mul(simGridSizeYUniform).add(gy);
    const gridOffsetTop = gx.mul(simGridSizeYUniform).add(gy.add(uint(1)));
    const gridOffsetDiag = gx.add(uint(1)).mul(simGridSizeYUniform).add(gy.add(uint(1)));
    const minDist = float(1).toVar();

    If(gx.greaterThan(uint(0)), () => {
      const edgeId = simHorizontalEdgeIdBuffer.element(gridOffset);
      const broken = isEdgeBroken(edgeId);
      const dist = fracX;
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    If(gx.lessThan(maxGridX), () => {
      const edgeId = simHorizontalEdgeIdBuffer.element(gridOffsetRight);
      const broken = isEdgeBroken(edgeId);
      const dist = float(1).sub(fracX);
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    If(gy.greaterThan(uint(0)), () => {
      const edgeId = simVerticalEdgeIdBuffer.element(gridOffset);
      const broken = isEdgeBroken(edgeId);
      const dist = fracY;
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    If(gy.lessThan(maxGridY), () => {
      const edgeId = simVerticalEdgeIdBuffer.element(gridOffsetTop);
      const broken = isEdgeBroken(edgeId);
      const dist = float(1).sub(fracY);
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    If(gx.lessThan(maxGridX).and(gy.lessThan(maxGridY)), () => {
      const edgeId = simShearDownEdgeIdBuffer.element(gridOffsetDiag);
      const broken = isEdgeBroken(edgeId);
      const dist = abs(fracY.sub(fracX)).mul(0.7071);
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    If(gx.lessThan(maxGridX).and(gy.greaterThan(uint(0))), () => {
      const edgeId = simShearUpEdgeIdBuffer.element(gridOffsetRight);
      const broken = isEdgeBroken(edgeId);
      const dist = abs(fracY.sub(float(1).sub(fracX))).mul(0.7071);
      minDist.assign(min(minDist, select(broken, dist, float(1))));
    });

    return minDist;
  });

  const applyTearColorFromMinDistance = Fn(([baseColor, minDist]) => {
    const fringeWidth = tearFringeWidthUniform.max(float(0.001));
    const fray = float(1).sub(minDist.div(fringeWidth).clamp(0, 1));
    const frayActive = select(minDist.lessThan(fringeWidth), fray, float(0));
    const frayTint = baseColor.mul(0.42);
    return mix(baseColor, frayTint, frayActive.mul(0.9));
  });

  const applyTearRoughnessFromMinDistance = Fn(([baseRoughness, minDist]) => {
    const fringeWidth = tearFringeWidthUniform.max(float(0.001));
    const fray = float(1).sub(minDist.div(fringeWidth).clamp(0, 1));
    const frayActive = select(minDist.lessThan(fringeWidth), fray, float(0));
    return mix(baseRoughness, baseRoughness.mul(1.45), frayActive.mul(0.85));
  });

  return {
    computeTearMinDistance,
    applyTearColorFromMinDistance,
    applyTearRoughnessFromMinDistance,
  };
}
