export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type CardinalEdge = 'top' | 'right' | 'bottom' | 'left';

export interface GarmentPanel {
  readonly id: string;
  readonly label: string;
  readonly outline: readonly Vec2[];
  readonly edges: Readonly<Record<CardinalEdge, PatternEdge>>;
  readonly segmentsX: number;
  readonly segmentsY: number;
  readonly placement: PanelPlacement;
  readonly grainAngleRad: number;
}

export interface PatternEdge {
  readonly id: string;
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface PanelPlacement {
  readonly origin: Vec3;
  /** Euler rotation in radians for initial drape placement. */
  readonly rotation: Vec3;
}

export interface SeamEndpoint {
  readonly panelId: string;
  readonly edgeId: CardinalEdge;
  readonly reversed?: boolean;
}

export type SeamKind = 'stitch' | 'dart' | 'pleat' | 'hem' | 'fold-guide';

export interface GarmentSeam {
  readonly id: string;
  readonly kind: SeamKind;
  readonly a: SeamEndpoint;
  readonly b: SeamEndpoint;
  /**
   * Ease lets one edge gather onto another. 0 means equal lengths, positive
   * values mean endpoint A may be longer than endpoint B by this ratio.
   */
  readonly easeRatio?: number;
}

export interface PleatModifier {
  readonly type: 'pleat';
  readonly panelId: string;
  readonly id: string;
  readonly count: number;
  readonly depth: number;
  readonly direction: 'left' | 'right' | 'box';
  readonly region: {
    readonly from: Vec2;
    readonly to: Vec2;
  };
}

export interface GarmentPattern {
  readonly id: string;
  readonly label: string;
  readonly panels: readonly GarmentPanel[];
  readonly seams: readonly GarmentSeam[];
  readonly modifiers: readonly PleatModifier[];
}

export interface SeamValidationIssue {
  readonly seamId: string;
  readonly message: string;
  readonly lengthA?: number;
  readonly lengthB?: number;
}

export interface RectPanelOptions {
  readonly id: string;
  readonly label?: string;
  readonly width: number;
  readonly height: number;
  readonly segmentsX?: number;
  readonly segmentsY?: number;
  readonly placement?: Partial<PanelPlacement>;
  readonly grainAngleRad?: number;
}

export interface TrapezoidPanelOptions extends RectPanelOptions {
  readonly topWidth: number;
  readonly bottomWidth: number;
}

export interface TubePatternOptions {
  readonly id?: string;
  readonly label?: string;
  readonly circumference: number;
  readonly height: number;
  readonly panelCount?: number;
  readonly flareRatio?: number;
  readonly segmentsAround?: number;
  readonly segmentsHeight?: number;
}

export interface TShirtPatternOptions {
  readonly id?: string;
  readonly label?: string;
  readonly chestWidth: number;
  readonly torsoHeight: number;
  readonly sleeveLength: number;
  readonly sleeveOpening: number;
  readonly shoulderWidth?: number;
  readonly segmentsX?: number;
  readonly segmentsY?: number;
}

export interface KimonoPatternOptions {
  readonly id?: string;
  readonly label?: string;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly sleeveLength: number;
  readonly sleeveWidth: number;
  readonly segmentsX?: number;
  readonly segmentsY?: number;
}

export interface PleatOptions {
  readonly panelId: string;
  readonly id?: string;
  readonly count: number;
  readonly depth: number;
  readonly direction?: PleatModifier['direction'];
  readonly from: Vec2;
  readonly to: Vec2;
}

const DEFAULT_SEGMENTS_PER_METER = 18;
const SEAM_LENGTH_EPS = 1e-4;

export function createRectPanel(options: RectPanelOptions): GarmentPanel {
  assertPositive(options.width, 'width');
  assertPositive(options.height, 'height');

  const width = options.width;
  const height = options.height;
  const outline: readonly Vec2[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];

  return {
    id: options.id,
    label: options.label ?? options.id,
    outline,
    edges: cardinalEdges(options.id, outline),
    segmentsX: options.segmentsX ?? defaultSegments(width),
    segmentsY: options.segmentsY ?? defaultSegments(height),
    placement: completePlacement(options.placement),
    grainAngleRad: options.grainAngleRad ?? 0,
  };
}

export function createTrapezoidPanel(options: TrapezoidPanelOptions): GarmentPanel {
  assertPositive(options.topWidth, 'topWidth');
  assertPositive(options.bottomWidth, 'bottomWidth');
  assertPositive(options.height, 'height');

  const widest = Math.max(options.topWidth, options.bottomWidth);
  const topInset = (widest - options.topWidth) * 0.5;
  const bottomInset = (widest - options.bottomWidth) * 0.5;
  const outline: readonly Vec2[] = [
    [bottomInset, 0],
    [bottomInset + options.bottomWidth, 0],
    [topInset + options.topWidth, options.height],
    [topInset, options.height],
  ];

  return {
    id: options.id,
    label: options.label ?? options.id,
    outline,
    edges: cardinalEdges(options.id, outline),
    segmentsX: options.segmentsX ?? defaultSegments(widest),
    segmentsY: options.segmentsY ?? defaultSegments(options.height),
    placement: completePlacement(options.placement),
    grainAngleRad: options.grainAngleRad ?? 0,
  };
}

export function createTubePattern(options: TubePatternOptions): GarmentPattern {
  assertPositive(options.circumference, 'circumference');
  assertPositive(options.height, 'height');

  const panelCount = options.panelCount ?? 4;
  if (panelCount < 2) {
    throw new Error('panelCount must be at least 2');
  }

  const radius = options.circumference / (Math.PI * 2);
  const topWidth = options.circumference / panelCount;
  const bottomWidth = topWidth * (options.flareRatio ?? 1);
  const panels: GarmentPanel[] = [];
  const seams: GarmentSeam[] = [];
  const segmentsAround = options.segmentsAround ?? defaultSegments(options.circumference);
  const segmentsX = Math.max(2, Math.round(segmentsAround / panelCount));
  const segmentsY = options.segmentsHeight ?? defaultSegments(options.height);

  for (let i = 0; i < panelCount; i++) {
    const angle = (i / panelCount) * Math.PI * 2;
    panels.push(
      createTrapezoidPanel({
        id: `tube-panel-${i}`,
        label: `Tube panel ${i + 1}`,
        width: Math.max(topWidth, bottomWidth),
        topWidth,
        bottomWidth,
        height: options.height,
        segmentsX,
        segmentsY,
        placement: {
          origin: [Math.cos(angle) * radius, options.height * 0.5, Math.sin(angle) * radius],
          rotation: [0, -angle, 0],
        },
      }),
    );
  }

  for (let i = 0; i < panelCount; i++) {
    seams.push({
      id: `tube-side-${i}`,
      kind: 'stitch',
      a: { panelId: panels[i]!.id, edgeId: 'right' },
      b: { panelId: panels[(i + 1) % panelCount]!.id, edgeId: 'left', reversed: true },
    });
  }

  return {
    id: options.id ?? 'tube',
    label: options.label ?? 'Tube garment',
    panels,
    seams,
    modifiers: [],
  };
}

export function createTShirtPattern(options: TShirtPatternOptions): GarmentPattern {
  const shoulderWidth = options.shoulderWidth ?? options.chestWidth * 1.08;
  const segmentsX = options.segmentsX ?? defaultSegments(shoulderWidth);
  const segmentsY = options.segmentsY ?? defaultSegments(options.torsoHeight);
  const front = createRectPanel({
    id: 'shirt-front',
    label: 'Shirt front',
    width: shoulderWidth,
    height: options.torsoHeight,
    segmentsX,
    segmentsY,
    placement: { origin: [0, options.torsoHeight * 0.5, 0.22] },
  });
  const back = createRectPanel({
    id: 'shirt-back',
    label: 'Shirt back',
    width: shoulderWidth,
    height: options.torsoHeight,
    segmentsX,
    segmentsY,
    placement: { origin: [0, options.torsoHeight * 0.5, -0.22], rotation: [0, Math.PI, 0] },
  });
  const leftSleeve = createRectPanel({
    id: 'shirt-left-sleeve',
    label: 'Left sleeve',
    width: options.sleeveLength,
    height: options.sleeveOpening,
    segmentsX: defaultSegments(options.sleeveLength),
    segmentsY: defaultSegments(options.sleeveOpening),
    placement: { origin: [-shoulderWidth * 0.65, options.torsoHeight * 0.85, 0] },
  });
  const rightSleeve = createRectPanel({
    id: 'shirt-right-sleeve',
    label: 'Right sleeve',
    width: options.sleeveLength,
    height: options.sleeveOpening,
    segmentsX: defaultSegments(options.sleeveLength),
    segmentsY: defaultSegments(options.sleeveOpening),
    placement: { origin: [shoulderWidth * 0.65, options.torsoHeight * 0.85, 0] },
  });

  return {
    id: options.id ?? 't-shirt',
    label: options.label ?? 'T-shirt',
    panels: [front, back, leftSleeve, rightSleeve],
    seams: [
      sideSeam('shirt-left-side', front.id, 'left', back.id, 'right'),
      sideSeam('shirt-right-side', front.id, 'right', back.id, 'left'),
      sideSeam('shirt-left-sleeve-underarm', leftSleeve.id, 'top', leftSleeve.id, 'bottom'),
      sideSeam('shirt-right-sleeve-underarm', rightSleeve.id, 'top', rightSleeve.id, 'bottom'),
      {
        id: 'shirt-left-armhole',
        kind: 'stitch',
        a: { panelId: front.id, edgeId: 'top' },
        b: { panelId: leftSleeve.id, edgeId: 'left' },
        easeRatio: 0.25,
      },
      {
        id: 'shirt-right-armhole',
        kind: 'stitch',
        a: { panelId: back.id, edgeId: 'top' },
        b: { panelId: rightSleeve.id, edgeId: 'left' },
        easeRatio: 0.25,
      },
    ],
    modifiers: [],
  };
}

export function createKimonoPattern(options: KimonoPatternOptions): GarmentPattern {
  const halfBody = options.bodyWidth * 0.5;
  const back = createRectPanel({
    id: 'kimono-back',
    label: 'Kimono back',
    width: options.bodyWidth,
    height: options.bodyHeight,
    segmentsX: options.segmentsX ?? defaultSegments(options.bodyWidth),
    segmentsY: options.segmentsY ?? defaultSegments(options.bodyHeight),
  });
  const leftFront = createRectPanel({
    id: 'kimono-left-front',
    label: 'Left front',
    width: halfBody,
    height: options.bodyHeight,
    segmentsX: defaultSegments(halfBody),
    segmentsY: options.segmentsY ?? defaultSegments(options.bodyHeight),
  });
  const rightFront = createRectPanel({
    id: 'kimono-right-front',
    label: 'Right front',
    width: halfBody,
    height: options.bodyHeight,
    segmentsX: defaultSegments(halfBody),
    segmentsY: options.segmentsY ?? defaultSegments(options.bodyHeight),
  });
  const leftSleeve = createRectPanel({
    id: 'kimono-left-sleeve',
    label: 'Left rectangular sleeve',
    width: options.sleeveLength,
    height: options.sleeveWidth,
  });
  const rightSleeve = createRectPanel({
    id: 'kimono-right-sleeve',
    label: 'Right rectangular sleeve',
    width: options.sleeveLength,
    height: options.sleeveWidth,
  });

  return {
    id: options.id ?? 'kimono',
    label: options.label ?? 'Kimono',
    panels: [back, leftFront, rightFront, leftSleeve, rightSleeve],
    seams: [
      sideSeam('kimono-left-side', leftFront.id, 'left', back.id, 'right'),
      sideSeam('kimono-right-side', rightFront.id, 'right', back.id, 'left'),
      {
        id: 'kimono-left-sleeve-attach',
        kind: 'stitch',
        a: { panelId: back.id, edgeId: 'top' },
        b: { panelId: leftSleeve.id, edgeId: 'left' },
        easeRatio: 0.35,
      },
      {
        id: 'kimono-right-sleeve-attach',
        kind: 'stitch',
        a: { panelId: rightFront.id, edgeId: 'top' },
        b: { panelId: rightSleeve.id, edgeId: 'left' },
        easeRatio: 0.35,
      },
      sideSeam('kimono-left-sleeve-underarm', leftSleeve.id, 'top', leftSleeve.id, 'bottom'),
      sideSeam('kimono-right-sleeve-underarm', rightSleeve.id, 'top', rightSleeve.id, 'bottom'),
    ],
    modifiers: [],
  };
}

export function withPleats(pattern: GarmentPattern, options: PleatOptions): GarmentPattern {
  if (!pattern.panels.some((panel) => panel.id === options.panelId)) {
    throw new Error(`Unknown panel "${options.panelId}" for pleat modifier`);
  }

  const modifier: PleatModifier = {
    type: 'pleat',
    panelId: options.panelId,
    id: options.id ?? `${options.panelId}-pleat-${pattern.modifiers.length}`,
    count: options.count,
    depth: options.depth,
    direction: options.direction ?? 'box',
    region: {
      from: options.from,
      to: options.to,
    },
  };

  return {
    ...pattern,
    modifiers: [...pattern.modifiers, modifier],
  };
}

export function validateGarmentPattern(pattern: GarmentPattern): SeamValidationIssue[] {
  const issues: SeamValidationIssue[] = [];
  const panelById = new Map(pattern.panels.map((panel) => [panel.id, panel]));

  for (const seam of pattern.seams) {
    const panelA = panelById.get(seam.a.panelId);
    const panelB = panelById.get(seam.b.panelId);
    if (!panelA || !panelB) {
      issues.push({ seamId: seam.id, message: 'Seam references a missing panel' });
      continue;
    }

    const edgeA = panelA.edges[seam.a.edgeId];
    const edgeB = panelB.edges[seam.b.edgeId];
    const lengthA = edgeLength(edgeA);
    const lengthB = edgeLength(edgeB);
    const allowedMismatch = Math.max(lengthA, lengthB) * (seam.easeRatio ?? 0) + SEAM_LENGTH_EPS;

    if (Math.abs(lengthA - lengthB) > allowedMismatch) {
      issues.push({
        seamId: seam.id,
        message: 'Stitched edge lengths differ more than the seam ease allows',
        lengthA,
        lengthB,
      });
    }
  }

  return issues;
}

export function edgeLength(edge: PatternEdge): number {
  return Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
}

function cardinalEdges(panelId: string, outline: readonly Vec2[]): Record<CardinalEdge, PatternEdge> {
  return {
    bottom: { id: `${panelId}:bottom`, from: outline[0]!, to: outline[1]! },
    right: { id: `${panelId}:right`, from: outline[1]!, to: outline[2]! },
    top: { id: `${panelId}:top`, from: outline[3]!, to: outline[2]! },
    left: { id: `${panelId}:left`, from: outline[0]!, to: outline[3]! },
  };
}

function sideSeam(
  id: string,
  panelA: string,
  edgeA: CardinalEdge,
  panelB: string,
  edgeB: CardinalEdge,
): GarmentSeam {
  return {
    id,
    kind: 'stitch',
    a: { panelId: panelA, edgeId: edgeA },
    b: { panelId: panelB, edgeId: edgeB, reversed: true },
  };
}

function defaultSegments(length: number): number {
  return Math.max(2, Math.ceil(length * DEFAULT_SEGMENTS_PER_METER));
}

function completePlacement(placement?: Partial<PanelPlacement>): PanelPlacement {
  return {
    origin: placement?.origin ?? [0, 0, 0],
    rotation: placement?.rotation ?? [0, 0, 0],
  };
}

function assertPositive(value: number, name: string): void {
  if (!(value > 0)) {
    throw new Error(`${name} must be positive`);
  }
}
