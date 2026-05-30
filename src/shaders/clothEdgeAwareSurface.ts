import { Fn, float, mix, select, uint } from 'three/tsl';

type InstancedArray = ReturnType<typeof import('three/tsl').instancedArray>;
type UniformNode = ReturnType<typeof import('three/tsl').uniform>;

export interface ClothEdgeAwareSurfaceContext {
  vertexPositionBuffer: InstancedArray;
  gridIndex: ReturnType<typeof Fn>;
  gridStrideY: UniformNode;
  gridMaxXUniform: UniformNode;
  gridMaxYUniform: UniformNode;
  gridMaxXUint: ReturnType<typeof uint>;
  gridMaxYUint: ReturnType<typeof uint>;
  isEdgeBroken: ReturnType<typeof Fn>;
  simHorizontalEdgeIdBuffer: InstancedArray;
  simVerticalEdgeIdBuffer: InstancedArray;
  simShearDownEdgeIdBuffer: InstancedArray;
  simShearUpEdgeIdBuffer: InstancedArray;
}

export function createEdgeAwareSimSurfaceSampler(context: ClothEdgeAwareSurfaceContext) {
  const {
    vertexPositionBuffer,
    gridIndex,
    gridStrideY,
    gridMaxXUniform,
    gridMaxYUniform,
    gridMaxXUint,
    gridMaxYUint,
    isEdgeBroken,
    simHorizontalEdgeIdBuffer,
    simVerticalEdgeIdBuffer,
    simShearDownEdgeIdBuffer,
    simShearUpEdgeIdBuffer,
  } = context;

  return Fn(([simGridX, simGridY]) => {
    const cx = simGridX.clamp(0, float(gridMaxXUniform));
    const cy = simGridY.clamp(0, float(gridMaxYUniform));
    const gridX0 = cx.floor();
    const gridY0 = cy.floor();
    const fx = cx.sub(gridX0);
    const fy = cy.sub(gridY0);
    const gx0 = uint(gridX0);
    const gy0 = uint(gridY0);
    const gx1 = select(gx0.lessThan(gridMaxXUint), gx0.add(uint(1)), gx0);
    const gy1 = select(gy0.lessThan(gridMaxYUint), gy0.add(uint(1)), gy0);

    const p00 = vertexPositionBuffer.element(gridIndex(gx0, gy0));
    const p10 = vertexPositionBuffer.element(gridIndex(gx1, gy0));
    const p01 = vertexPositionBuffer.element(gridIndex(gx0, gy1));
    const p11 = vertexPositionBuffer.element(gridIndex(gx1, gy1));

    const gridOffsetRight = gx1.mul(gridStrideY).add(gy0);
    const gridOffsetTopRight = gx1.mul(gridStrideY).add(gy1);
    const gridOffsetTop = gx0.mul(gridStrideY).add(gy1);
    const bottomEdgeBroken = gx0
      .greaterThan(uint(0))
      .and(isEdgeBroken(simHorizontalEdgeIdBuffer.element(gridOffsetRight)));
    const topEdgeBroken = gy1
      .lessThan(gridMaxYUint)
      .and(isEdgeBroken(simHorizontalEdgeIdBuffer.element(gridOffsetTopRight)));
    const leftEdgeBroken = gy0
      .greaterThan(uint(0))
      .and(isEdgeBroken(simVerticalEdgeIdBuffer.element(gridOffsetTop)));
    const rightEdgeBroken = gx1
      .lessThan(gridMaxXUint)
      .and(isEdgeBroken(simVerticalEdgeIdBuffer.element(gridOffsetTopRight)));

    const shearDownBroken = gx1
      .lessThan(gridMaxXUint)
      .and(gy1.lessThan(gridMaxYUint))
      .and(isEdgeBroken(simShearDownEdgeIdBuffer.element(gridOffsetTopRight)));
    const shearUpBroken = gx1
      .lessThan(gridMaxXUint)
      .and(gy0.greaterThan(uint(0)))
      .and(isEdgeBroken(simShearUpEdgeIdBuffer.element(gridOffsetRight)));

    const cellEpsilon = float(0.0001);
    const bilinear = mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
    const westColumn = mix(p00, p01, fy);
    const eastColumn = mix(p10, p11, fy);

    const cornerQuadrant = select(
      fy.greaterThan(0.5),
      select(fx.greaterThan(0.5), p11, p01),
      select(fx.greaterThan(0.5), p10, p00),
    );

    const mixBottomRow = select(
      leftEdgeBroken,
      p10,
      select(rightEdgeBroken, p00, mix(p00, p10, fx)),
    );
    const mixTopRow = select(
      leftEdgeBroken,
      p11,
      select(rightEdgeBroken, p01, mix(p01, p11, fx)),
    );

    const bottomTear = select(fy.greaterThan(cellEpsilon), mixTopRow, mixBottomRow);
    const topTear = select(fy.lessThan(float(1).sub(cellEpsilon)), mixBottomRow, mixTopRow);

    const anyStructuralBreak = bottomEdgeBroken
      .or(topEdgeBroken)
      .or(leftEdgeBroken)
      .or(rightEdgeBroken);

    const shearUpLower = p00.mul(float(1).sub(fx).sub(fy)).add(p10.mul(fx)).add(p01.mul(fy));
    const shearUpUpper = p11
      .mul(fx.add(fy).sub(1))
      .add(p10.mul(float(1).sub(fy)))
      .add(p01.mul(float(1).sub(fx)));
    const shearUpSplit = select(fx.add(fy).lessThanEqual(1), shearUpLower, shearUpUpper);

    const shearDownLower = p00.mul(float(1).sub(fx)).add(p10.mul(fx.sub(fy))).add(p11.mul(fy));
    const shearDownUpper = p00.mul(float(1).sub(fy)).add(p01.mul(fy.sub(fx))).add(p11.mul(fx));
    const shearDownSplit = select(fy.lessThanEqual(fx), shearDownLower, shearDownUpper);

    const shearSplit = select(
      shearUpBroken.and(shearDownBroken),
      cornerQuadrant,
      select(
        shearUpBroken,
        shearUpSplit,
        select(shearDownBroken, shearDownSplit, bilinear),
      ),
    );

    const verticalTear = select(
      leftEdgeBroken.and(rightEdgeBroken),
      cornerQuadrant,
      select(rightEdgeBroken, westColumn, select(leftEdgeBroken, eastColumn, shearSplit)),
    );

    const structuralPos = select(
      bottomEdgeBroken.and(topEdgeBroken),
      cornerQuadrant,
      select(bottomEdgeBroken, bottomTear, select(topEdgeBroken, topTear, verticalTear)),
    );

    return select(anyStructuralBreak, structuralPos, shearSplit);
  });
}
