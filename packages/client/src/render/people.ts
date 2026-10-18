import {
  BoxGeometry, SphereGeometry, CylinderGeometry, BufferGeometry, Float32BufferAttribute, InstancedMesh, InstancedBufferAttribute,
  MeshLambertMaterial, MeshDepthMaterial, RGBADepthPacking, DynamicDrawUsage,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CitizenState, LifeStage, Zone, hash2 } from '@msimcity/shared';
import { sceneUniforms } from './materials';

/**
 * Pedestrians: one low-poly figure per person (head, hair, torso, arms, legs, shoes, plus optional hats, bags and the
 * like), drawn as instances of a single merged geometry. Each vertex knows its colour slot, the limb it hangs from and
 * the feature that gates it; each instance carries its palette, feature bits and gait as packed floats, and the vertex
 * shader poses the figure (leg and arm swing, knees and elbows, stoop, idle sway, phone and hammer poses) and hides
 * the features that person does not have. No skeletons, no mixers: two draws (near and far detail) for the crowd.
 *
 * Everything about a person's look is seeded from their id, then dressed by what they do: suits for office workers,
 * hi-vis and hard hats on builders and factory hands, scrubs and white coats at the hospital, uniforms for police and
 * firefighters, school jumpers and backpacks on children, flat caps and walking sticks on some retirees, and something
 * else again for a night out.
 */

/** colour slots (aBody.x) */
const P = { skin: 0, hair: 1, top: 2, sleeve: 3, inner: 4, accent: 5, legs: 6, thigh: 7, shin: 8, shoe: 9, leather: 10, phone: 11, wood: 12 } as const;
/** limbs (aBody.y): the joint chain a vertex rides on */
const L = { none: 0, lUpper: 1, lFore: 2, rUpper: 3, rFore: 4, lThigh: 5, lShin: 6, rThigh: 7, rShin: 8, head: 9 } as const;
/** feature bits in the instance flags; geometry gated by one is collapsed unless the person has it */
const G = {
  hairCap: 0, hairLong: 1, hairBun: 2, hairTail: 3, hairAfro: 4, hairQuiff: 5,
  skirt: 6, coat: 7, sideBag: 8, backpack: 9, briefcase: 10, cap: 11, hardHat: 12, phone: 13,
  shirtFront: 14, tie: 15, stick: 16, bands: 17,
  /** not geometry: forearms bare, shins bare, child head proportions */
  shortSleeves: 18, shorts: 19, child: 20,
} as const;

// figure dimensions in tiles for an adult of scale 1 (the head top at ~0.39, like the old capsule people)
const HIP = 0.19, KNEE = 0.105, SHOULDER = 0.302, ELBOW = 0.225, NECK = 0.322, ARM_Z = 0.064, LEG_Z = 0.023;
/** eye height of a scale-1 figure, for the first-person camera */
export const EYE = 0.358;

/**
 * Merges the figure's parts into one indexed geometry. The material is flat shaded (face normals come from screen-space
 * derivatives), so corners are shared and normals dropped: a box is 8 vertices instead of 24.
 */
class Builder {
  pos: number[] = []; body: number[] = []; idx: number[] = [];
  add(src: BufferGeometry, part: number, limb: number = L.none, gate = -1) {
    src.deleteAttribute('normal'); src.deleteAttribute('uv');
    const g = mergeVertices(src, 1e-5);
    const base = this.pos.length / 3;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.body.push(part, limb, gate + 1);
    }
    for (let i = 0; i < g.index!.count; i++) this.idx.push(base + g.index!.getX(i));
    src.dispose(); g.dispose();
    return this;
  }
  /** box w(x, forward) × h × d(z, sideways) with its base at y */
  box(w: number, h: number, d: number, x: number, y: number, z: number, part: number, limb: number = L.none, gate = -1) {
    return this.add(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), part, limb, gate);
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    // flat shading ignores vertex normals, but the shadow code still normalises one: give it a harmless up
    g.setAttribute('normal', new Float32BufferAttribute(this.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aBody', new Float32BufferAttribute(this.body, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** the torso: a tapered box, broad at the shoulders and narrower at the waist */
const torsoGeo = (y0: number, h: number, grow = 1, open = false) => {
  const t = 0.052 * grow, b = 0.04 * grow;
  return new CylinderGeometry(t - (t - b) * (y0 - 0.205) / 0.11, t - (t - b) * (y0 + h - 0.205) / 0.11, h, 4, 1, open)
    .rotateY(Math.PI / 4).scale(0.62, 1, 1.36).translate(0, y0 + h / 2, 0);
};
/** a cap of a sphere (the top `frac` of it), tipped back so it sits like hair or a hat */
const dome = (r: number, w: number, hs: number, frac: number, tilt: number) => new SphereGeometry(r, w, hs, 0, Math.PI * 2, 0, Math.PI * frac).rotateZ(tilt);

function figure(near: boolean): BufferGeometry {
  const k = new Builder();
  // legs: thigh, shin and shoe, swinging from the hip
  for (const [s, thigh, shin] of [[-1, L.lThigh, L.lShin], [1, L.rThigh, L.rShin]] as const) {
    const z = s * LEG_Z;
    if (near) {
      k.box(0.036, HIP - KNEE + 0.004, 0.034, 0, KNEE - 0.002, z, P.thigh, thigh)
        .box(0.03, KNEE - 0.018, 0.03, 0, 0.018, z, P.shin, shin)
        .box(0.052, 0.022, 0.034, 0.009, 0, z, P.shoe, shin);
    } else k.box(0.034, HIP, 0.032, 0, 0, z, P.legs, thigh);
  }
  k.box(0.05, 0.04, 0.078, 0, 0.175, 0, P.legs);
  k.add(torsoGeo(0.205, 0.11), P.top);
  // arms: upper arm and forearm with the hand, hanging from the shoulder
  for (const [s, upper, fore] of [[-1, L.lUpper, L.lFore], [1, L.rUpper, L.rFore]] as const) {
    const z = s * ARM_Z;
    if (near) {
      k.box(0.026, SHOULDER - ELBOW + 0.005, 0.026, 0, ELBOW, z, P.top, upper)
        .box(0.023, ELBOW - 0.148 + 0.003, 0.023, 0, 0.148, z, P.sleeve, fore)
        .box(0.018, 0.027, 0.015, 0, 0.123, z, P.skin, fore);
    } else k.box(0.025, SHOULDER - 0.13, 0.025, 0, 0.13, z, P.top, upper);
  }
  // head and hair
  const hw = near ? 7 : 6, hh = near ? 5 : 4;
  k.add(new SphereGeometry(0.033, hw, hh).scale(0.95, 1.08, 0.9).translate(0, 0.356, 0), P.skin, L.head);
  k.add(dome(0.0355, hw, near ? 4 : 2, 0.5, 0.6).scale(0.97, 1.1, 0.93).translate(-0.004, 0.359, 0), P.hair, L.head, G.hairCap);
  k.box(0.02, 0.072, 0.066, -0.027, 0.298, 0, P.hair, L.head, G.hairLong);
  k.add(dome(0.045, hw, near ? 5 : 3, 0.62, 0.55).scale(1, 0.92, 1).translate(-0.01, 0.362, 0), P.hair, L.head, G.hairAfro);
  if (near) {
    k.add(new CylinderGeometry(0.013, 0.015, 0.02, 5, 1, true).translate(0, NECK - 0.006, 0), P.skin, L.head)
      .box(0.012, 0.012, 0.01, 0.03, 0.344, 0, P.skin, L.head)
      .box(0.004, 0.006, 0.007, 0.0298, 0.358, -0.011, P.phone, L.head).box(0.004, 0.006, 0.007, 0.0298, 0.358, 0.011, P.phone, L.head)
      .add(new SphereGeometry(0.017, 6, 4).translate(-0.031, 0.38, 0), P.hair, L.head, G.hairBun)
      .add(new BoxGeometry(0.016, 0.05, 0.016).rotateZ(-0.35).translate(-0.042, 0.34, 0), P.hair, L.head, G.hairTail)
      .add(new BoxGeometry(0.03, 0.016, 0.052).rotateZ(-0.25).translate(0.016, 0.386, 0), P.hair, L.head, G.hairQuiff);
    // clothes and kit
    k.add(new CylinderGeometry(0.044, 0.066, 0.078, 7, 1, true).translate(0, 0.162, 0), P.legs, L.none, G.skirt)
      .add(new CylinderGeometry(0.05, 0.062, 0.09, 6, 1, true).scale(0.78, 1, 1).translate(0, 0.17, 0), P.top, L.none, G.coat)
      .box(0.006, 0.066, 0.028, 0.022, 0.25, 0, P.inner, L.none, G.shirtFront)
      .box(0.006, 0.058, 0.01, 0.0255, 0.252, 0, P.accent, L.none, G.tie)
      .add(torsoGeo(0.232, 0.011, 1.07, true), P.inner, L.none, G.bands)
      .add(torsoGeo(0.268, 0.011, 1.07, true), P.inner, L.none, G.bands)
      .box(0.016, 0.046, 0.05, -0.012, 0.162, 0.058, P.leather, L.none, G.sideBag)
      .box(0.03, 0.078, 0.068, -0.038, 0.214, 0, P.accent, L.none, G.backpack)
      .box(0.062, 0.046, 0.014, 0.004, 0.072, ARM_Z, P.leather, L.rFore, G.briefcase)
      .box(0.012, 0.022, 0.006, 0.006, 0.124, -ARM_Z, P.phone, L.lFore, G.phone)
      .box(0.01, 0.13, 0.01, 0.012, 0.0, ARM_Z + 0.004, P.wood, L.rFore, G.stick)
      .add(dome(0.037, 8, 3, 0.5, 0.1).scale(1, 0.72, 0.95).translate(0, 0.364, 0), P.accent, L.head, G.cap)
      .box(0.034, 0.005, 0.05, 0.04, 0.364, 0, P.accent, L.head, G.cap)
      .add(dome(0.04, 8, 4, 0.5, 0.05).scale(1.05, 0.88, 0.97).translate(0, 0.366, 0), P.accent, L.head, G.hardHat)
      .add(new CylinderGeometry(0.043, 0.043, 0.005, 10, 1).scale(1.12, 1, 0.95).translate(0.006, 0.364, 0), P.accent, L.head, G.hardHat);
  } else {
    k.add(dome(0.038, 6, 2, 0.5, 0.1).translate(0, 0.364, 0), P.accent, L.head, G.cap)
      .add(dome(0.042, 6, 2, 0.5, 0.05).translate(0, 0.366, 0), P.accent, L.head, G.hardHat)
      .add(new CylinderGeometry(0.044, 0.064, 0.078, 6, 1, true).translate(0, 0.162, 0), P.legs, L.none, G.skirt)
      .box(0.03, 0.078, 0.068, -0.038, 0.214, 0, P.accent, L.none, G.backpack);
  }
  return k.build();
}

const POSE_GLSL = /* glsl */ `
attribute vec3 aBody;
attribute vec4 iColA;
attribute vec4 iColB;
attribute vec4 iAnim;
vec3 mscHex(float h) { return pow(vec3(floor(h / 65536.0), mod(floor(h / 256.0), 256.0), mod(h, 256.0)) / 255.0, vec3(2.2)); }
bool mscBit(int f, int b) { return ((f >> b) & 1) == 1; }
// rotate p about the z axis through pivot (x, y): positive swings a hanging limb forward (+x)
vec3 mscSwing(vec3 p, vec2 pivot, float a) {
  float c = cos(a), s = sin(a);
  vec2 d = p.xy - pivot;
  return vec3(pivot + vec2(d.x * c - d.y * s, d.x * s + d.y * c), p.z);
}
void mscPose(inout vec3 p) {
  int part = int(aBody.x + 0.5), limb = int(aBody.y + 0.5), gate = int(aBody.z + 0.5) - 1;
  int f = int(iColB.w + 0.5);
  float ph = iAnim.x, amp = iAnim.y, stoop = iAnim.z, pose = iAnim.w;
  if ((gate >= 0 && !mscBit(f, gate)) || (gate == ${G.phone} && pose < 0.35)) { p = vec3(0.0); return; }
  float s = sin(ph), c = cos(ph), still = 1.0 - min(amp * 2.0, 1.0);
  float phone = max(pose, 0.0), work = max(-pose, 0.0);
  float tool = sin(ph * 1.7);
  // legs: thighs swing opposite each other, the knee folds while that leg comes forward
  if (limb >= ${L.lThigh} && limb <= ${L.rShin}) {
    float side = limb <= ${L.lShin} ? 1.0 : -1.0;
    float hip = side * s * amp;
    if (limb == ${L.lShin} || limb == ${L.rShin}) {
      float knee = -amp * 1.25 * max(0.0, side * c) - 0.05 * amp;
      p = mscSwing(p, vec2(0.0, ${KNEE}), knee);
    }
    p = mscSwing(p, vec2(0.0, ${HIP}), hip);
  }
  // arms swing against the legs, elbows soft; a phone in the left hand, a hammer arm for work on site
  if (limb >= ${L.lUpper} && limb <= ${L.rFore}) {
    bool left = limb <= ${L.lFore};
    float side = left ? -1.0 : 1.0;
    float sh = side * s * amp * 0.85;
    float el = 0.12 + amp * 0.35 * (0.6 + 0.4 * side * s);
    if (left) { sh = mix(sh, 0.08, phone); el = mix(el, 1.3, phone); }
    else { sh = mix(sh, 1.0 + 0.55 * tool, work); el = mix(el, 0.9 + 0.5 * sin(ph * 1.7 + 1.1), work); }
    if (limb == ${L.lFore} || limb == ${L.rFore}) { p = mscSwing(p, vec2(0.0, ${ELBOW}), el); }
    p = mscSwing(p, vec2(0.0, ${SHOULDER}), sh);
  }
  // the head: bigger on children, looking about while standing, looking down at a phone, held up against a stoop
  if (limb == ${L.head}) {
    if (mscBit(f, ${G.child})) p = vec3(0.0, ${NECK}, 0.0) + (p - vec3(0.0, ${NECK}, 0.0)) * 1.2;
    float turn = still * (0.45 * sin(ph * 0.06 + mod(iColA.x, 61.0)) + 0.25 * sin(ph * 0.17 + mod(iColA.y, 37.0)));
    float ct = cos(turn), st = sin(turn);
    vec3 d = p - vec3(0.0, ${NECK}, 0.0);
    p = vec3(0.0, ${NECK}, 0.0) + vec3(d.x * ct - d.z * st, d.y, d.x * st + d.z * ct);
    float nod = stoop * 0.6 - phone * 0.35;
    p = mscSwing(p, vec2(0.0, ${NECK}), nod);
  }
  // stoop: everything above the hips leans forward (legs and the skirt stay put)
  bool upper = limb == ${L.head} || (limb >= ${L.lUpper} && limb <= ${L.rFore}) || (limb == 0 && p.y > ${HIP} && gate != ${G.skirt});
  if (upper) {
    float lean = -stoop - 0.05 * amp - 0.12 * work;
    p = mscSwing(p, vec2(0.0, ${HIP}), lean);
  }
  // walking bob (highest as the legs pass) and a slow weight shift while standing
  p.y += abs(c) * 0.008 * amp;
  float sway = still * 0.035 * sin(ph * 0.11 + mod(iColA.z, 53.0));
  float cs = cos(sway), ss = sin(sway);
  p = vec3(p.x, p.y * cs - p.z * ss, p.y * ss + p.z * cs);
}`;

const COLOR_GLSL = /* glsl */ `
  int mscPart = int(aBody.x + 0.5), mscF = int(iColB.w + 0.5);
  vec3 mscSkin = mscHex(iColA.x), mscLegs = mscHex(iColA.w);
  bool mscBare = mscBit(mscF, ${G.skirt});
  vec3 mscC = mscSkin;
  if (mscPart == ${P.hair}) mscC = mscHex(iColA.y);
  else if (mscPart == ${P.top}) mscC = mscHex(iColA.z);
  else if (mscPart == ${P.sleeve}) mscC = mscBit(mscF, ${G.shortSleeves}) ? mscSkin : mscHex(iColA.z);
  else if (mscPart == ${P.inner}) mscC = mscHex(iColB.x);
  else if (mscPart == ${P.accent}) mscC = mscHex(iColB.z);
  else if (mscPart == ${P.legs}) mscC = mscLegs;
  else if (mscPart == ${P.thigh}) mscC = mscBare ? mscSkin : mscLegs;
  else if (mscPart == ${P.shin}) mscC = mscBare || mscBit(mscF, ${G.shorts}) ? mscSkin : mscLegs;
  else if (mscPart == ${P.shoe}) mscC = mscHex(iColB.y);
  else if (mscPart == ${P.leather}) mscC = mscHex(iColB.y) * 0.8 + 0.02;
  else if (mscPart == ${P.phone}) mscC = vec3(0.012);
  else if (mscPart == ${P.wood}) mscC = vec3(0.12, 0.06, 0.025);
  // a touch of ground occlusion at the feet
  vPCol = mscC * (0.82 + 0.18 * smoothstep(0.0, 0.3, position.y));`;

let shared: { mat: MeshLambertMaterial; depth: MeshDepthMaterial } | null = null;
function materials() {
  if (shared) return shared;
  const mat = new MeshLambertMaterial({ flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sceneUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_GLSL}\nvarying vec3 vPCol;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nvec3 mscP = position;\nmscPose(mscP);\n${COLOR_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = mscP;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPCol;\nuniform float uNight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPCol;')
      // like the cars: a fill in the figure's own colours, so the side away from the sun (or street lamp) is not a black cut-out
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(0.12, 0.07, uNight);');
  };
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nmscPose(transformed);');
  };
  return (shared = { mat, depth });
}

/** A person's look, worked out once per outfit change: packed palettes, feature bits and build. */
export interface Look {
  /** skin, hair, top, legs (24-bit sRGB as floats) */
  a: [number, number, number, number];
  /** inner (shirt or reflective bands), shoes, accent (hat, tie, backpack), feature bits */
  b: [number, number, number, number];
  /** height and girth scale, stoop (radians), step rate (radians of gait per ms) */
  height: number; girth: number; stoop: number; pace: number;
  /** uses a phone while standing about */
  phone: boolean;
  /** how far they turn from the way they were heading when standing in a crowd (radians) */
  turn: number;
  /** which outfit this is: 'w' work, 'l' leisure, 'e' evening out */
  dress: string;
}

const SKIN = [0xf6d7c3, 0xeec1a0, 0xe2ae88, 0xcf9670, 0xb07650, 0x8d5a3a, 0x6c432b, 0x4f3020];
const HAIR_DARK = [0x17120f, 0x241912, 0x2f2018];
const HAIR_ANY = [0x17120f, 0x2b1d14, 0x3b2618, 0x5a3a22, 0x6a4428, 0x8a5a34, 0x8b3f20, 0xb8763c, 0xc9a35e, 0xdcc07e];
const HAIR_OLD = [0x8e8e8e, 0xa8a8a8, 0xc4c4c4, 0xdedede, 0xeeeeee, 0x6f6a66];
const HAIR_DYED = [0x6a4fc4, 0xd2508a, 0x3a8fd0, 0x2fa38a, 0xc0392b];
const CASUAL_TOP = [0xd94b3d, 0x3a86c8, 0x3aa569, 0xe8c547, 0x8d5bb0, 0xeeeeea, 0x2e3e52, 0x98a3a8, 0xe07f2c, 0x24a88e, 0xb5482c, 0x6e7a80,
  0xf0d2c0, 0x283442, 0x9c2b2b, 0x8a7a62, 0xfafafa, 0x2a2a2c, 0x5b7a3a, 0xc76b8f, 0x4a5f8a, 0xd9b38c];
const CASUAL_LEGS = [0x2f4a73, 0x35507e, 0x4a6fa5, 0x22252b, 0x3a3d44, 0xb8a07a, 0x7a7d82, 0x5a4a3a, 0x6b7a4a, 0x2c3e66];
const SHOES = [0xf0f0f0, 0xeeeeee, 0x1c1c1e, 0x2a2a2a, 0x4a2f1e, 0x6b4428, 0xc0392b, 0x2e6fb5, 0x8a8a8a];
const BRIGHT = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6fa8, 0x34495e];
const OLD_TOP = [0xcbb994, 0x7a5c44, 0x6b7048, 0x2c3a5a, 0x7b2d3a, 0x8c8c88, 0xa89a7c, 0x4a5a4a, 0xd8d0c0, 0x5a4a6a];
const OLD_LEGS = [0x6a6a68, 0x8c8272, 0x2c3a5a, 0x4a4a4c, 0xa89a7c, 0x3a3a3c];
const SUIT = [0x33363d, 0x26314f, 0x5f646d, 0x1f2024, 0x3a3f4a, 0x8a7a64, 0x41394a];
const SHIRT = [0xf4f4f2, 0xf4f4f2, 0xcfe0f2, 0xf1d6dc, 0xe6ecd8];
const TIE = [0xa8323a, 0x26314f, 0x6b2335, 0x2a7a7a, 0xc89b3a, 0x3a3a3a];
const EVENING = [0x1d1d22, 0x6b2335, 0x1f6b4f, 0x26314f, 0xf4f4f2, 0x7a2a6a, 0xb8902a, 0x2a2a30, 0xc0392b];
const SCRUBS = [0x4fb3a9, 0x6fa8dc, 0x3d7f6a, 0x8e6fb5, 0x2f6f9a];
const BRAND = [0x2e86de, 0x27ae60, 0xc0392b, 0x8e44ad, 0xe67e22, 0x16a085, 0x2c3e50, 0xd35400];
const SCHOOL = [0x26314f, 0x6b2335, 0x1f5b3f, 0x5a6a7a, 0x8a2a2a];
const HIVIS = [0xf2d230, 0xff8c2a, 0xd8e83a];
const HARDHAT = [0xf2c230, 0xf4f4f4, 0xff8c2a, 0x3a86c8];

const bit = (b: number) => 1 << b;
/** a colour lightened or darkened by up to ±`r` for this person, so no two red jumpers are quite the same red */
function jit(hex: number, u: number, r = 0.1) {
  const k = 1 + (u - 0.5) * 2 * r;
  const ch = (s: number) => Math.min(255, Math.max(0, Math.round(((hex >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Dress a person for what they are doing: `work` on the way to or from (or at) their job, otherwise leisure; `evening` after dark. */
export function lookOf(id: number, kind: number, stage: number, work: boolean, evening: boolean): Look {
  let n = 100;
  const h = () => hash2(id, n++);
  const pick = <T>(a: readonly T[]) => a[Math.floor(h() * a.length)];
  const child = stage === LifeStage.Child, old = stage === LifeStage.Retired;
  // body and face first, so they stay the same whatever the person wears
  const si = Math.floor(h() * SKIN.length), skin = jit(SKIN[si], h(), 0.05);
  const hu = h();
  let hair = old && hu < 0.8 ? pick(HAIR_OLD) : hu > 0.975 && !old ? pick(HAIR_DYED) : si >= 5 || h() < 0.35 ? pick(HAIR_DARK) : pick(HAIR_ANY);
  hair = jit(hair, h(), 0.12);
  const hs = h();
  let f = 0;
  // hair styles: bald, crop, long, bun, ponytail, afro, quiff
  const style = old ? (hs < 0.25 ? 0 : hs < 0.6 ? 1 : hs < 0.75 ? 3 : hs < 0.9 ? 2 : 6)
    : child ? (hs < 0.35 ? 1 : hs < 0.55 ? 4 : hs < 0.75 ? 2 : hs < 0.85 ? 5 : 3)
    : (hs < 0.05 ? 0 : hs < 0.33 ? 1 : hs < 0.53 ? 2 : hs < 0.61 ? 3 : hs < 0.71 ? 4 : hs < (si >= 5 ? 0.86 : 0.75) ? 5 : 6);
  if (style === 1 || style === 2 || style === 3 || style === 4 || style === 6) f |= bit(G.hairCap);
  f |= [0, 0, bit(G.hairLong), bit(G.hairBun), bit(G.hairTail), bit(G.hairAfro), bit(G.hairQuiff)][style];
  const height = child ? 0.62 + h() * 0.12 : old ? 0.9 + h() * 0.1 : 0.92 + h() * 0.16;
  const girth = child ? 0.86 + h() * 0.1 : old ? 0.95 + h() * 0.22 : 0.88 + h() * 0.28;
  const stoop = old ? 0.08 + h() * 0.22 : 0;
  const pace = (old ? 0.011 : child ? 0.018 : 0.014) * (0.9 + h() * 0.2);
  const phone = h() < (child ? 0.2 : old ? 0.08 : 0.4), turn = (h() - 0.5) * 2;
  if (child) f |= bit(G.child);
  if (phone) f |= bit(G.phone);
  // a separate stream for clothes, so changing outfit does not re-roll the face
  n = 200 + (work ? 0 : evening ? 40 : 20);
  let top = 0, legs = 0, inner = 0xd0d4da, shoe = pick(SHOES), acc = pick(BRIGHT);
  const casual = () => {
    top = jit(pick(CASUAL_TOP), h()); legs = jit(pick(CASUAL_LEGS), h());
    if (h() < (child ? 0.45 : 0.18)) f |= bit(G.shorts);
    if (h() < (child ? 0.55 : 0.4)) f |= bit(G.shortSleeves);
    if (!child && h() < 0.16) { f |= bit(G.skirt); legs = jit(pick([...CASUAL_TOP, ...CASUAL_LEGS]), h()); }
    if (h() < (child ? 0.15 : 0.08)) f |= bit(G.cap);
    if (h() < (child ? 0.5 : 0.12)) f |= bit(G.backpack); else if (!child && h() < 0.18) f |= bit(G.sideBag);
  };
  const hivis = () => { top = jit(pick(HIVIS), h(), 0.06); f |= bit(G.bands); inner = 0xd0d4da; };
  if (old) {
    top = jit(pick(OLD_TOP), h()); legs = jit(pick(OLD_LEGS), h()); shoe = pick([0x2a2a2a, 0x4a2f1e, 0x6b4428, 0x8a8a8a]);
    if (h() < 0.3) f |= bit(G.coat);
    if (h() < 0.12) { f |= bit(G.skirt); legs = jit(pick(OLD_TOP), h()); }
    if (h() < 0.2) { f |= bit(G.cap); acc = jit(pick([0x6e5a44, 0x5a5a52, 0x2c3a5a]), h()); }
    if (h() < 0.25) f |= bit(G.stick); else if (h() < 0.2) f |= bit(G.sideBag);
  } else if (child) {
    casual();
    if (work && h() < 0.55) { top = jit(pick(SCHOOL), h(), 0.05); legs = pick([0x4a4a4c, 0x3a3a3c, 0x26314f]); f &= ~bit(G.cap); f |= bit(G.backpack); f &= ~bit(G.shortSleeves); }
  } else if (!work) {
    if (evening) {
      top = jit(pick(EVENING), h()); legs = jit(pick([0x1d1d22, 0x26314f, 0x2a2a30, 0x3a3d44, 0x2f4a73]), h());
      shoe = pick([0x1c1c1e, 0x2a2a2a, 0x4a2f1e, 0x6b2335, 0xf0f0f0]);
      if (h() < 0.25) { f |= bit(G.skirt); legs = top; }
      if (h() < 0.2) f |= bit(G.coat);
      if (h() < 0.2) f |= bit(G.sideBag);
      if (h() < 0.3) f |= bit(G.shortSleeves);
    } else casual();
  } else {
    switch (kind) {
      case Zone.Office: {
        top = jit(pick(SUIT), h(), 0.08); legs = h() < 0.85 ? top : jit(pick(SUIT), h(), 0.08);
        inner = pick(SHIRT); f |= bit(G.shirtFront); shoe = pick([0x1c1c1e, 0x1c1c1e, 0x4a2f1e, 0x6b4428]);
        if (h() < 0.55) { f |= bit(G.tie); acc = pick(TIE); }
        if (h() < 0.25) f |= bit(G.skirt);
        if (h() < 0.3) f |= bit(G.briefcase); else if (h() < 0.25) f |= bit(G.sideBag);
        if (h() < 0.12) f |= bit(G.coat);
        break;
      }
      case Zone.Industrial: {
        shoe = pick([0x3a2a1e, 0x2a2a2a, 0x5a3a22]);
        if (h() < 0.5) { top = legs = jit(pick([0x2c3e66, 0xd9682b, 0x4f5a3a, 0x3a5a7a, 0x8a3a2a]), h(), 0.08); }
        else { hivis(); legs = jit(pick([0x34495e, 0x2f4a73, 0x3a3d44, 0x5b5340]), h()); }
        if (h() < 0.45) { f |= bit(G.hardHat); acc = pick(HARDHAT); }
        if (h() < 0.5) f |= bit(G.shortSleeves);
        break;
      }
      case Zone.Yard: {
        hivis(); legs = jit(pick([0x5b5340, 0x34495e, 0x2f4a73, 0x6a5a40]), h()); shoe = pick([0x3a2a1e, 0x5a3a22, 0x2a2a2a]);
        if (h() < 0.85) { f |= bit(G.hardHat); acc = pick(HARDHAT); }
        if (h() < 0.5) f |= bit(G.shortSleeves);
        break;
      }
      case Zone.Police: {
        legs = 0x1b2236; shoe = 0x141414;
        if (h() < 0.5) { hivis(); top = jit(0xd6e04a, h(), 0.05); } else top = jit(0x1f2d4f, h(), 0.06);
        if (h() < 0.6) { f |= bit(G.cap); acc = 0x1b2236; }
        break;
      }
      case Zone.Fire: {
        legs = jit(0x232c3d, h(), 0.06); shoe = 0x141414;
        top = h() < 0.5 ? jit(0xc0392b, h(), 0.06) : jit(0x232c3d, h(), 0.06);
        if (h() < 0.3) { hivis(); top = jit(0xb8a05a, h(), 0.05); legs = top; }
        if (h() < 0.5) f |= bit(G.shortSleeves);
        break;
      }
      case Zone.Hospital: {
        shoe = pick([0xf0f0f0, 0xeeeeee, 0x2a7ab8, 0x1c1c1e]);
        if (h() < 0.65) { top = legs = jit(pick(SCRUBS), h(), 0.06); f |= bit(G.shortSleeves); }
        else { top = 0xf4f6f8; inner = pick(SHIRT); f |= bit(G.coat) | bit(G.shirtFront); legs = jit(pick([0x3a3d44, 0x26314f, 0x5a5a5c]), h()); }
        break;
      }
      case Zone.Commercial: {
        top = jit(pick(BRAND), h(), 0.06); legs = pick([0x1c1c1e, 0x26314f, 0xb8a07a, 0x3a3d44]);
        if (h() < 0.6) f |= bit(G.shortSleeves);
        if (h() < 0.15) f |= bit(G.skirt);
        if (h() < 0.2) f |= bit(G.sideBag);
        break;
      }
      case Zone.Hub: {
        if (h() < 0.5) { top = jit(0x24304f, h(), 0.05); legs = top; inner = 0xf4f4f2; f |= bit(G.shirtFront) | bit(G.tie); acc = pick([0xc0392b, 0xc89b3a, 0x2a7a7a]); }
        else { hivis(); legs = jit(0x2a2a30, h()); }
        break;
      }
      default: casual();
    }
  }
  // hats sit on the hair: crops, buns, afros and quiffs go under them, long hair and ponytails still show
  if (f & (bit(G.cap) | bit(G.hardHat))) f &= ~(bit(G.hairCap) | bit(G.hairBun) | bit(G.hairAfro) | bit(G.hairQuiff));
  return { a: [skin, hair, top, legs], b: [inner, shoe, acc, f], height, girth, stoop, pace, phone, turn, dress: work ? 'w' : evening ? 'e' : 'l' };
}

/** Whether this state dresses for work (`true`), for leisure (`false`), or keeps whatever they had on (`null`, walking home). */
export function dressFor(state: number, kind: number): boolean | null {
  if (state === CitizenState.ToVenue || state === CitizenState.AtVenue) return false;
  if (state === CitizenState.ToHome) return null;
  return kind !== Zone.None || state === CitizenState.ToWork;
}

/** One instanced crowd: a figure geometry (near or far detail) plus its per-instance palettes and gait. */
export class Crowd {
  mesh: InstancedMesh;
  private colA: InstancedBufferAttribute; private colB: InstancedBufferAttribute; private anim: InstancedBufferAttribute;
  n = 0;
  /** `own`: a material of its own, so the underground view (which ghosts the surface's by material) leaves this crowd solid */
  constructor(near: boolean, cap: number, geometry?: BufferGeometry, own = false) {
    const geo = geometry ?? figure(near);
    const { mat, depth } = materials();
    const material = own ? Object.assign(mat.clone(), { onBeforeCompile: mat.onBeforeCompile }) : mat;
    this.mesh = new InstancedMesh(geo, material, cap);
    this.mesh.customDepthMaterial = depth;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const attr = (name: string) => {
      const a = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.colA = attr('iColA'); this.colB = attr('iColB'); this.anim = attr('iAnim');
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
  }
  get full() { return this.n >= this.mesh.instanceMatrix.count; }
  /** One person standing at (x, y, z) facing `yaw` (forward is (cos, -sin)); gait: phase and stride swing (radians), pose (+phone, -hammering). */
  put(x: number, y: number, z: number, yaw: number, look: Look, phase: number, swing: number, pose: number) {
    const i = this.n++, c = Math.cos(yaw), s = Math.sin(yaw), g = look.girth, h = look.height;
    const m = this.mesh.instanceMatrix.array as Float32Array, o = i * 16;
    // a rotation about y, scaled by girth and height, written straight into the buffer
    m[o] = c * g; m[o + 1] = 0; m[o + 2] = -s * g; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = h; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s * g; m[o + 9] = 0; m[o + 10] = c * g; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const a = this.colA.array as Float32Array, b = this.colB.array as Float32Array, n = this.anim.array as Float32Array, q = i * 4;
    a[q] = look.a[0]; a[q + 1] = look.a[1]; a[q + 2] = look.a[2]; a[q + 3] = look.a[3];
    b[q] = look.b[0]; b[q + 1] = look.b[1]; b[q + 2] = look.b[2]; b[q + 3] = look.b[3];
    n[q] = phase; n[q + 1] = swing; n[q + 2] = look.stoop; n[q + 3] = pose;
  }
  begin() { this.n = 0; }
  end() {
    this.mesh.count = this.n;
    for (const a of [this.mesh.instanceMatrix, this.colA, this.colB, this.anim]) {
      a.clearUpdateRanges();
      if (this.n) a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
  /** a second crowd drawing the same figure (the selected person's own copy) */
  twin(cap: number) { return new Crowd(true, cap, this.mesh.geometry.clone()); }
}
