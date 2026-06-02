import {
  createOctagonalTubeAssembly,
  createPyramidAssembly,
  createStitchedBoxAssembly,
  createTShirtAssembly,
  type ClothAssembly,
} from '../cloth';

export type TubeAssemblySpawnKind = 'box' | 'octagonalTube' | 'pyramid' | 'tshirt';

export function measureTShirtSleeves(assembly: ClothAssembly): {
  crossSectionHeight: number;
  crossSectionDepth: number;
  cuffDrop: number;
  vertexCount: number;
} {
  const sleeveVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('sleeve'));
  const ys = sleeveVertices.map((vertex) => vertex.position[1]);
  const zs = sleeveVertices.map((vertex) => vertex.position[2]);
  const sleeveStats = ['tshirt-left-sleeve', 'tshirt-right-sleeve'].map((patchId) => {
    const vertices = assembly.vertices.filter((vertex) => vertex.patchId === patchId);
    const xs = vertices.map((vertex) => vertex.position[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const isLeft = patchId.includes('left');
    const span = Math.max(0.0001, maxX - minX);
    const cuff = vertices.filter((vertex) =>
      isLeft ? vertex.position[0] < minX + span * 0.12 : vertex.position[0] > maxX - span * 0.12,
    );
    const inner = vertices.filter((vertex) =>
      isLeft ? vertex.position[0] > maxX - span * 0.12 : vertex.position[0] < minX + span * 0.12,
    );
    const averageY = (items: typeof vertices): number =>
      items.reduce((sum, vertex) => sum + vertex.position[1], 0) / Math.max(1, items.length);
    return averageY(inner) - averageY(cuff);
  });

  return {
    crossSectionHeight: Math.max(...ys) - Math.min(...ys),
    crossSectionDepth: Math.max(...zs) - Math.min(...zs),
    cuffDrop: Math.min(...sleeveStats),
    vertexCount: sleeveVertices.length,
  };
}

export function createTubePageAssembly(kind: TubeAssemblySpawnKind): ClothAssembly {
  switch (kind) {
    case 'box':
      return createStitchedBoxAssembly({ width: 0.7, height: 0.7, depth: 0.7, segments: 12 });
    case 'octagonalTube':
      return createOctagonalTubeAssembly({ radius: 0.38, height: 0.9, segmentsAround: 4, segmentsHeight: 12 });
    case 'pyramid':
      return createPyramidAssembly({ baseSize: 0.9, height: 0.8, includeBase: true });
    case 'tshirt':
      return createTShirtAssembly({
        bodyWidth: 0.78,
        torsoHeight: 0.86,
        sleeveLength: 0.38,
        sleeveOpening: 0.34,
        sleeveTubeRadius: 0.12,
        depth: 0.32,
        bodySegmentsX: 24,
        bodySegmentsY: 28,
        sleeveSegmentsX: 16,
      });
  }
}
