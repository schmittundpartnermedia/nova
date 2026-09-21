import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";

export type MorphTargetIndex = {
  dictionary: Record<string, number>;
  influences: number[];
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIASES: Record<string, string[]> = {
  jawOpen: ["jawOpen", "jaw_open", "MouthOpen", "viseme_aa", "V_Open"],
  jawForward: ["jawForward", "jaw_forward"],
  jawLeft: ["jawLeft", "jaw_L", "jaw_left"],
  jawRight: ["jawRight", "jaw_R", "jaw_right"],
  mouthClose: ["mouthClose", "mouth_close"],
  mouthFunnel: ["mouthFunnel", "mouth_funnel", "viseme_O", "V_Oh"],
  mouthPucker: ["mouthPucker", "mouth_pucker", "viseme_U", "V_Ou"],
  mouthLeft: ["mouthLeft", "mouth_L"],
  mouthRight: ["mouthRight", "mouth_R"],
  mouthSmileLeft: ["mouthSmileLeft", "mouthSmile_L", "smileLeft"],
  mouthSmileRight: ["mouthSmileRight", "mouthSmile_R", "smileRight"],
  mouthFrownLeft: ["mouthFrownLeft", "mouthFrown_L"],
  mouthFrownRight: ["mouthFrownRight", "mouthFrown_R"],
  mouthDimpleLeft: ["mouthDimpleLeft", "mouthDimple_L"],
  mouthDimpleRight: ["mouthDimpleRight", "mouthDimple_R"],
  mouthStretchLeft: ["mouthStretchLeft", "mouthStretch_L"],
  mouthStretchRight: ["mouthStretchRight", "mouthStretch_R"],
  mouthRollLower: ["mouthRollLower", "mouth_roll_lower"],
  mouthRollUpper: ["mouthRollUpper", "mouth_roll_upper"],
  mouthShrugLower: ["mouthShrugLower"],
  mouthShrugUpper: ["mouthShrugUpper"],
  mouthPressLeft: ["mouthPressLeft", "mouthPress_L"],
  mouthPressRight: ["mouthPressRight", "mouthPress_R"],
  mouthLowerDownLeft: ["mouthLowerDownLeft", "mouthLowerDown_L"],
  mouthLowerDownRight: ["mouthLowerDownRight", "mouthLowerDown_R"],
  mouthUpperUpLeft: ["mouthUpperUpLeft", "mouthUpperUp_L"],
  mouthUpperUpRight: ["mouthUpperUpRight", "mouthUpperUp_R"],
  eyeBlinkLeft: ["eyeBlinkLeft", "eyeBlink_L", "blinkLeft", "eye_blink_L"],
  eyeBlinkRight: ["eyeBlinkRight", "eyeBlink_R", "blinkRight", "eye_blink_R"],
  eyeSquintLeft: ["eyeSquintLeft", "eyeSquint_L"],
  eyeSquintRight: ["eyeSquintRight", "eyeSquint_R"],
  eyeLookUpLeft: ["eyeLookUpLeft", "eyeLookUp_L"],
  eyeLookUpRight: ["eyeLookUpRight", "eyeLookUp_R"],
  eyeLookDownLeft: ["eyeLookDownLeft", "eyeLookDown_L"],
  eyeLookDownRight: ["eyeLookDownRight", "eyeLookDown_R"],
  eyeLookInLeft: ["eyeLookInLeft", "eyeLookIn_L"],
  eyeLookInRight: ["eyeLookInRight", "eyeLookIn_R"],
  eyeLookOutLeft: ["eyeLookOutLeft", "eyeLookOut_L"],
  eyeLookOutRight: ["eyeLookOutRight", "eyeLookOut_R"],
  eyeWideLeft: ["eyeWideLeft", "eyeWide_L"],
  eyeWideRight: ["eyeWideRight", "eyeWide_R"],
  browDownLeft: ["browDownLeft", "browDown_L"],
  browDownRight: ["browDownRight", "browDown_R"],
  browInnerUp: ["browInnerUp", "brow_inner_up"],
  browOuterUpLeft: ["browOuterUpLeft", "browOuterUp_L"],
  browOuterUpRight: ["browOuterUpRight", "browOuterUp_R"],
  cheekPuff: ["cheekPuff", "cheek_puff"],
  cheekSquintLeft: ["cheekSquintLeft", "cheekSquint_L"],
  cheekSquintRight: ["cheekSquintRight", "cheekSquint_R"],
  noseSneerLeft: ["noseSneerLeft", "noseSneer_L"],
  noseSneerRight: ["noseSneerRight", "noseSneer_R"],
  tongueOut: ["tongueOut", "tongue_out"],
};

const BONE_ALIASES: Record<string, string[]> = {
  Root: ["Root", "root", "Hips", "hips", "mixamorigHips"],
  Spine: ["Spine", "spine", "Spine1", "mixamorigSpine"],
  Neck: ["Neck", "neck", "Neck_M", "mixamorigNeck"],
  Head: ["Head", "head", "Head_M", "mixamorigHead", "mixamorig:Head"],
  Jaw: ["Jaw", "jaw", "Jaw_M", "mandible"],
  LeftEye: ["LeftEye", "eye_L", "Eye_L", "Left_Eye", "mixamorigLeftEye"],
  RightEye: ["RightEye", "eye_R", "Eye_R", "Right_Eye", "mixamorigRightEye"],
};

function buildLookup(names: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const name of names) lookup.set(normalizeKey(name), name);
  return lookup;
}

export class NovaFacialRigAdapter {
  private morphLookup = new Map<string, string>();
  private boneLookup = new Map<string, string>();
  private contractToMorph = new Map<string, string>();
  private contractToBone = new Map<string, string>();

  loadRig(input: { morphTargetNames: string[]; boneNames: string[] }) {
    this.morphLookup = buildLookup(input.morphTargetNames);
    this.boneLookup = buildLookup(input.boneNames);
    this.contractToMorph.clear();
    this.contractToBone.clear();

    for (const contract of NOVA_BLENDSHAPE_NAMES) {
      const aliases = ALIASES[contract] ?? [contract];
      for (const alias of aliases) {
        const found = this.morphLookup.get(normalizeKey(alias));
        if (found) {
          this.contractToMorph.set(contract, found);
          break;
        }
      }
    }

    for (const [contract, aliases] of Object.entries(BONE_ALIASES)) {
      for (const alias of aliases) {
        const found = this.boneLookup.get(normalizeKey(alias));
        if (found) {
          this.contractToBone.set(contract, found);
          break;
        }
      }
    }
  }

  resolveMorph(contractName: string): string | null {
    return this.contractToMorph.get(contractName) ?? this.morphLookup.get(normalizeKey(contractName)) ?? null;
  }

  resolveBone(contractName: string): string | null {
    return this.contractToBone.get(contractName) ?? this.boneLookup.get(normalizeKey(contractName)) ?? null;
  }

  mapBlendshapes(weights: Record<string, number>): Record<string, number> {
    const mapped: Record<string, number> = {};
    for (const [name, value] of Object.entries(weights)) {
      const target = this.resolveMorph(name);
      if (!target) continue;
      mapped[target] = value;
    }
    return mapped;
  }

  mappedBlendshapes(): string[] {
    return [...this.contractToMorph.keys()];
  }

  unmappedBlendshapes(): string[] {
    return NOVA_BLENDSHAPE_NAMES.filter((name) => !this.contractToMorph.has(name));
  }

  mappedBones(): string[] {
    return [...this.contractToBone.keys()];
  }
}
