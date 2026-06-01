export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SweptCapsuleSample {
  readonly previousStart: Vec3Like;
  readonly previousEnd: Vec3Like;
  readonly currentStart: Vec3Like;
  readonly currentEnd: Vec3Like;
  readonly radius: number;
}

export interface SweptCapsuleContact {
  readonly signedDistance: number;
  readonly normal: Vec3Like;
  readonly colliderMotion: Vec3Like;
}

export function sampleSweptCapsuleContact(
  point: Vec3Like,
  capsule: SweptCapsuleSample,
  sampleCount = 3,
): SweptCapsuleContact {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestNormal: Vec3Like = { x: 0, y: 1, z: 0 };
  let bestMotion: Vec3Like = { x: 0, y: 0, z: 0 };
  const samples = Math.max(2, sampleCount);

  for (let i = 0; i < samples; i++) {
    const sweepT = samples === 1 ? 1 : i / (samples - 1);
    const start = lerp3(capsule.previousStart, capsule.currentStart, sweepT);
    const end = lerp3(capsule.previousEnd, capsule.currentEnd, sweepT);
    const segment = sub3(end, start);
    const segmentLenSq = Math.max(dot3(segment, segment), 1e-8);
    const capsuleT = clamp(dot3(sub3(point, start), segment) / segmentLenSq, 0, 1);
    const closest = add3(start, mul3(segment, capsuleT));
    const offset = sub3(point, closest);
    const len = Math.max(length3(offset), 1e-8);
    const signedDistance = len - capsule.radius;

    if (signedDistance < bestDistance) {
      const previousClosest = add3(
        capsule.previousStart,
        mul3(sub3(capsule.previousEnd, capsule.previousStart), capsuleT),
      );
      const currentClosest = add3(
        capsule.currentStart,
        mul3(sub3(capsule.currentEnd, capsule.currentStart), capsuleT),
      );
      bestDistance = signedDistance;
      bestNormal = mul3(offset, 1 / len);
      bestMotion = sub3(currentClosest, previousClosest);
    }
  }

  return {
    signedDistance: bestDistance,
    normal: bestNormal,
    colliderMotion: bestMotion,
  };
}

export function transferredColliderMotion(
  contact: SweptCapsuleContact,
  transfer = 0.65,
  maxMotion = 0.035,
): Vec3Like {
  if (dot3(contact.colliderMotion, contact.normal) <= 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const len = length3(contact.colliderMotion);
  const scale = Math.min(len, maxMotion) / Math.max(len, 1e-8);
  return mul3(contact.colliderMotion, scale * transfer);
}

function lerp3(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function add3(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub3(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function mul3(v: Vec3Like, scalar: number): Vec3Like {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot3(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length3(v: Vec3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
