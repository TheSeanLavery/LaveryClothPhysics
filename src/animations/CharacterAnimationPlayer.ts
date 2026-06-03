import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { retargetClipTracks } from './animationRetarget.ts';

async function loadFbxQuietly(loader: FBXLoader, url: string): Promise<THREE.Group> {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (message.includes('THREE.FBXLoader: Vertex has more than 4 skinning weights')) {
      return;
    }
    originalWarn(...args);
  };
  try {
    return await loader.loadAsync(url);
  } finally {
    console.warn = originalWarn;
  }
}

export interface CharacterAnimationPlayerOptions {
  readonly fadeDuration?: number;
}

export class CharacterAnimationPlayer {
  private readonly loader = new FBXLoader();
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private activeAction: THREE.AnimationAction | null = null;
  private activeClipName: string | null = null;
  private readonly finishedListeners = new Set<(clipName: string) => void>();

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    private readonly targetRoot: THREE.Object3D,
    private readonly targetBones: readonly THREE.Bone[],
    private readonly options: CharacterAnimationPlayerOptions = {},
  ) {
    this.mixer.addEventListener('finished', (event) => {
      const action = event.action as THREE.AnimationAction;
      if (action === this.activeAction && this.activeClipName) {
        this.finishedListeners.forEach((listener) => listener(this.activeClipName!));
      }
    });
  }

  getActiveClipName(): string | null {
    return this.activeClipName;
  }

  getActiveAction(): THREE.AnimationAction | null {
    return this.activeAction;
  }

  onFinished(listener: (clipName: string) => void): () => void {
    this.finishedListeners.add(listener);
    return () => this.finishedListeners.delete(listener);
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }

  async loadClip(url: string, displayName?: string): Promise<string> {
    const cached = this.clips.get(url);
    if (cached) {
      return cached.name;
    }
    const animRoot = await loadFbxQuietly(this.loader, url);
    if (!animRoot.animations || animRoot.animations.length === 0) {
      throw new Error(`No animation clips in ${url}`);
    }
    const sourceClip = animRoot.animations[0]!;
    const clipName = displayName ?? sourceClip.name ?? url.split('/').pop()?.replace('.fbx', '') ?? 'Clip';
    const retargeted = retargetClipTracks(sourceClip, animRoot, this.targetBones, clipName);
    if (retargeted.tracks.length === 0) {
      throw new Error(`No compatible tracks after retargeting ${url}`);
    }
    this.clips.set(url, retargeted);
    return retargeted.name;
  }

  playUrl(
    url: string,
    options: { fadeDuration?: number; loop?: boolean; displayName?: string } = {},
  ): Promise<string> {
    return this.loadClip(url, options.displayName).then((clipName) => {
      this.playCached(url, options);
      return clipName;
    });
  }

  playCached(
    url: string,
    options: { fadeDuration?: number; loop?: boolean } = {},
  ): void {
    const clip = this.clips.get(url);
    if (!clip) {
      throw new Error(`Clip not loaded: ${url}`);
    }
    let action = this.actions.get(url);
    if (!action) {
      action = this.mixer.clipAction(clip, this.targetRoot);
      this.actions.set(url, action);
    }
    const loop = options.loop ?? true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (!loop) {
      action.clampWhenFinished = true;
    }
    const fade = options.fadeDuration ?? this.options.fadeDuration ?? 0.35;
    action.reset().setEffectiveWeight(1).play();
    if (this.activeAction && this.activeAction !== action) {
      this.activeAction.crossFadeTo(action, Math.max(0.01, fade), false);
    }
    this.activeAction = action;
    this.activeClipName = clip.name;
  }

  crossfadeToAction(
    action: THREE.AnimationAction | null,
    clipName: string | null,
    fadeDuration = 0.35,
  ): void {
    if (!action || action === this.activeAction) {
      return;
    }
    action.reset().setEffectiveWeight(1).play();
    if (this.activeAction) {
      this.activeAction.crossFadeTo(action, Math.max(0.01, fadeDuration), false);
    }
    this.activeAction = action;
    this.activeClipName = clipName;
  }
}
