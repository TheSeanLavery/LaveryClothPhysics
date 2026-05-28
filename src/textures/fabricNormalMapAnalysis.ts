export interface FabricNormalMapStats {
  size: number;
  varianceR: number;
  varianceG: number;
  varianceB: number;
  maxChannelRange: number;
}

/** Analyze raw RGBA bytes from a tangent-space normal map (0-255). */
export function analyzeFabricNormalMapBytes(data: Uint8Array, size: number): FabricNormalMapStats {
  const channelMean = [0, 0, 0];
  const count = size * size;

  for (let i = 0; i < count; i++) {
    const base = i * 4;
    channelMean[0] += data[base]!;
    channelMean[1] += data[base + 1]!;
    channelMean[2] += data[base + 2]!;
  }

  channelMean[0] /= count;
  channelMean[1] /= count;
  channelMean[2] /= count;

  const channelVariance = [0, 0, 0];
  const channelMin = [255, 255, 255];
  const channelMax = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    const base = i * 4;
    for (let c = 0; c < 3; c++) {
      const value = data[base + c]!;
      channelMin[c] = Math.min(channelMin[c]!, value);
      channelMax[c] = Math.max(channelMax[c]!, value);
      const delta = value - channelMean[c]!;
      channelVariance[c] += delta * delta;
    }
  }

  return {
    size,
    varianceR: channelVariance[0]! / count,
    varianceG: channelVariance[1]! / count,
    varianceB: channelVariance[2]! / count,
    maxChannelRange: Math.max(
      channelMax[0]! - channelMin[0]!,
      channelMax[1]! - channelMin[1]!,
      channelMax[2]! - channelMin[2]!,
    ),
  };
}
