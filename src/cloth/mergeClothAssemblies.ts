import type {
  AssemblyEdge,
  AssemblyFace,
  AssemblyVertex,
  ClothAssembly,
} from './patternAssembly.ts';

function remapAssembly(
  source: ClothAssembly,
  vertexOffset: number,
  structuralEdgeOffset: number,
  stitchEdgeOffset: number,
  faceOffset: number,
  patchSuffix: string,
): {
  vertices: AssemblyVertex[];
  faces: AssemblyFace[];
  edges: AssemblyEdge[];
  stitchEdges: AssemblyEdge[];
} {
  const vertices = source.vertices.map((vertex, index) => ({
    id: vertexOffset + index,
    patchId: `${vertex.patchId}${patchSuffix}`,
    localId: vertex.localId,
    position: vertex.position,
    uv: vertex.uv,
  }));

  const faces = source.faces.map((face, index) => ({
    id: faceOffset + index,
    vertices: [
      face.vertices[0] + vertexOffset,
      face.vertices[1] + vertexOffset,
      face.vertices[2] + vertexOffset,
    ] as [number, number, number],
    source: face.source,
    stitchId: face.stitchId,
  }));

  const edges = source.edges.map((edge, index) => ({
    id: structuralEdgeOffset + index,
    a: edge.a + vertexOffset,
    b: edge.b + vertexOffset,
    kind: edge.kind,
    restLength: edge.restLength,
    sourceId: `${edge.sourceId}${patchSuffix}`,
  }));

  const stitchEdges = source.stitchEdges.map((edge, index) => ({
    id: stitchEdgeOffset + index,
    a: edge.a + vertexOffset,
    b: edge.b + vertexOffset,
    kind: edge.kind,
    restLength: edge.restLength,
    sourceId: `${edge.sourceId}${patchSuffix}`,
  }));

  return { vertices, faces, edges, stitchEdges };
}

export function mergeClothAssemblies(
  assemblies: readonly ClothAssembly[],
): ClothAssembly {
  if (assemblies.length === 0) {
    throw new Error('mergeClothAssemblies requires at least one assembly');
  }
  if (assemblies.length === 1) {
    return assemblies[0]!;
  }

  const mergedVertices: AssemblyVertex[] = [];
  const mergedFaces: AssemblyFace[] = [];
  const mergedEdges: AssemblyEdge[] = [];
  const mergedStitchEdges: AssemblyEdge[] = [];

  let vertexOffset = 0;
  let structuralEdgeOffset = 0;
  let stitchEdgeOffset = 0;
  let faceOffset = 0;

  assemblies.forEach((assembly, assemblyIndex) => {
    const suffix = assemblies.length > 1 ? `@${assemblyIndex}` : '';
    const remapped = remapAssembly(
      assembly,
      vertexOffset,
      structuralEdgeOffset,
      stitchEdgeOffset,
      faceOffset,
      suffix,
    );
    mergedVertices.push(...remapped.vertices);
    mergedFaces.push(...remapped.faces);
    mergedEdges.push(...remapped.edges);
    mergedStitchEdges.push(...remapped.stitchEdges);
    vertexOffset += assembly.vertices.length;
    structuralEdgeOffset += assembly.edges.length;
    stitchEdgeOffset += assembly.stitchEdges.length;
    faceOffset += assembly.faces.length;
  });

  return {
    vertices: mergedVertices,
    faces: mergedFaces,
    edges: mergedEdges,
    stitchEdges: mergedStitchEdges,
  };
}
