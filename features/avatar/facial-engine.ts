import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaFacialFrame, NovaVec3 } from "@/types/avatar";
import { emptyBlendshapes, LIP_SYNC_SET, clampWeight } from "@/features/avatar/contract";
import { NovaFacialRigAdapter } from "@/features/avatar/rig-adapter";
import { NovaBehaviorEngine, type BehaviorSample } from "@/features/avatar/behavior-engine";

export type FacialEngineOutput = {
  blendshapes: Record<string, number>;
  mappedBlendshapes: Record<string, number>;
  headRotation: NovaVec3;
  neckRotation: NovaVec3;
  eyeBoneRotation: NovaVec3;
  jawBoneRotation: NovaVec3;
  breath: number;
};

export class FacialAnimationEngine {
  private adapter = new NovaFacialRigAdapter();
  private behavior = new NovaBehaviorEngine();
  private current: Record<string, number> = emptyBlendshapes();
  private running = false;
  private speechFrame: NovaFacialFrame | null = null;
  private emotion: NovaAvatarEmotion = "neutral";
  private state: OrbState = "IDLE";
  private isSpeaking = false;
  private speechIntensity = 0;
  private reducedMotion = false;
  private headPoseOverride: NovaVec3 | null = null;

  initialize() {
    this.current = emptyBlendshapes();
    this.behavior.start(performance.now());
  }

  loadRig(input: { morphTargetNames: string[]; boneNames: string[] }) {
    this.adapter.loadRig(input);
  }

  getAdapter(): NovaFacialRigAdapter {
    return this.adapter;
  }

  start() {
    this.running = true;
    this.behavior.start(performance.now());
  }

  stop() {
    this.running = false;
    this.speechFrame = null;
    this.resetFace();
  }

  dispose() {
    this.stop();
  }

  setEmotion(emotion: NovaAvatarEmotion) {
    this.emotion = emotion;
  }

  setState(state: OrbState, isSpeaking: boolean, speechIntensity: number, emotion?: NovaAvatarEmotion) {
    this.state = state;
    this.isSpeaking = isSpeaking;
    this.speechIntensity = speechIntensity;
    if (emotion) this.emotion = emotion;
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
  }

  setHeadPose(rotation: NovaVec3 | null) {
    this.headPoseOverride = rotation;
  }

  applyFrame(frame: NovaFacialFrame | null) {
    this.speechFrame = frame;
  }

  setBlendshape(name: string, value: number) {
    this.current[name] = clampWeight(value);
  }

  setBlendshapes(weights: Record<string, number>) {
    for (const [name, value] of Object.entries(weights)) {
      this.current[name] = clampWeight(value);
    }
  }

  resetFace() {
    this.current = emptyBlendshapes();
    this.speechFrame = null;
  }

  sample(now = performance.now()): FacialEngineOutput {
    const behavior = this.behavior.sample(now, {
      state: this.state,
      emotion: this.emotion,
      isSpeaking: this.isSpeaking,
      speechIntensity: this.speechIntensity,
      reducedMotion: this.reducedMotion,
    });
    return this.compose(behavior);
  }

  private compose(behavior: BehaviorSample): FacialEngineOutput {
    const weights = emptyBlendshapes();
    for (const [name, value] of Object.entries(behavior.blendshapes)) {
      weights[name] = clampWeight(value);
    }

    if (this.speechFrame && this.isSpeaking) {
      for (const [name, value] of Object.entries(this.speechFrame.blendshapes)) {
        if (typeof value !== "number") continue;
        if (LIP_SYNC_SET.has(name) || name in weights) {
          weights[name] = LIP_SYNC_SET.has(name) ? clampWeight(value) : Math.max(weights[name] ?? 0, clampWeight(value));
        } else {
          weights[name] = clampWeight(value);
        }
      }
    } else if (this.state === "LISTENING") {
      for (const key of LIP_SYNC_SET) weights[key] = 0;
    }

    for (const [name, value] of Object.entries(this.current)) {
      if ((value ?? 0) > 0) weights[name] = clampWeight(value);
    }

    const jawOpen = weights.jawOpen ?? 0;
    return {
      blendshapes: weights,
      mappedBlendshapes: this.adapter.mapBlendshapes(weights),
      headRotation: this.headPoseOverride ?? this.speechFrame?.headRotation ?? behavior.headRotation,
      neckRotation: behavior.neckRotation,
      eyeBoneRotation: behavior.eyeBoneRotation,
      jawBoneRotation: { x: jawOpen * 0.28, y: 0, z: 0 },
      breath: behavior.breath,
    };
  }
}
