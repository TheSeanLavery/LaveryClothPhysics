import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  generateClothMaps,
  defaultClothGeneratorOptions,
} from '../src/textures/clothGenerator/generateClothMaps.ts';
import { CLOTH_PRESETS, CLOTH_PATTERN_LABELS } from '../src/textures/clothGenerator/presets.ts';
import type { ClothGeneratorOptions, ClothMapKind } from '../src/textures/clothGenerator/types.ts';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  writeU32BE(view, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeU32BE(view, 8 + data.length, crc32(crcInput));
  return chunk;
}

function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawRow = y * (stride + 1);
    raw[rawRow] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), rawRow + 1);
  }

  const compressed = deflateSync(raw, { level: 9 });
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  writeU32BE(ihdrView, 0, width);
  writeU32BE(ihdrView, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(compressed)),
    pngChunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function printHelp(): void {
  console.log(`Cloth texture generator (offline)

Usage:
  npm run generate:cloth -- [options]

Options:
  --pattern <id>     Pattern: ${Object.keys(CLOTH_PATTERN_LABELS).join(', ')}
  --preset <id>      Use a preset (${CLOTH_PRESETS.map((p) => p.id).join(', ')})
  --size <n>         Texture size (default 512)
  --cells-u <n>      Thread count U
  --cells-v <n>      Thread count V
  --bump <n>         Normal bump scale
  --seed <n>         Random seed
  --out <dir>        Output directory (default generated/cloth)
  --maps <list>      Comma-separated: normal,albedo,roughness,height (default all)
  --list-presets     Print preset ids
  --help             Show this help
`);
}

function parseArgs(argv: string[]): {
  options: ClothGeneratorOptions;
  outDir: string;
  maps: ClothMapKind[];
  listPresets: boolean;
} {
  let options = defaultClothGeneratorOptions('plain');
  let outDir = 'generated/cloth';
  let maps: ClothMapKind[] = ['normal', 'albedo', 'roughness', 'height'];
  let listPresets = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--list-presets':
        listPresets = true;
        break;
      case '--pattern':
        options = { ...options, pattern: next as ClothGeneratorOptions['pattern'] };
        i++;
        break;
      case '--preset': {
        const preset = CLOTH_PRESETS.find((entry) => entry.id === next);
        if (!preset) {
          throw new Error(`Unknown preset: ${next}`);
        }
        options = { ...preset.options };
        i++;
        break;
      }
      case '--size':
        options = { ...options, size: Number(next) };
        i++;
        break;
      case '--cells-u':
        options = { ...options, cellsU: Number(next) };
        i++;
        break;
      case '--cells-v':
        options = { ...options, cellsV: Number(next) };
        i++;
        break;
      case '--bump':
        options = { ...options, bumpScale: Number(next) };
        i++;
        break;
      case '--seed':
        options = { ...options, seed: Number(next) };
        i++;
        break;
      case '--out':
        outDir = next!;
        i++;
        break;
      case '--maps':
        maps = next!.split(',').map((entry) => entry.trim()) as ClothMapKind[];
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { options, outDir, maps, listPresets };
}

function main(): void {
  const { options, outDir, maps, listPresets } = parseArgs(process.argv.slice(2));

  if (listPresets) {
    for (const preset of CLOTH_PRESETS) {
      console.log(`${preset.id}\t${preset.label}`);
    }
    return;
  }

  const mapsSet = generateClothMaps(options);
  const folderName = `${options.pattern}-${options.size}`;
  const targetDir = resolve(outDir, folderName);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const manifest = {
    pattern: options.pattern,
    size: options.size,
    cellsU: options.cellsU,
    cellsV: options.cellsV,
    bumpScale: options.bumpScale,
    seed: options.seed,
    threadCover: options.threadCover,
    fiberStrength: options.fiberStrength,
    maps: maps.map((kind) => `${kind}.png`),
  };

  for (const kind of maps) {
    const rgba = mapsSet[kind];
    const png = encodeRgbaToPng(options.size, options.size, rgba);
    const filePath = join(targetDir, `${kind}.png`);
    writeFileSync(filePath, png);
    console.log(`wrote ${filePath}`);
  }

  writeFileSync(join(targetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Done. ${CLOTH_PATTERN_LABELS[options.pattern]} → ${targetDir}`);
}

main();
