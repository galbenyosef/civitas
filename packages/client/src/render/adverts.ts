import {
  CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, InstancedMesh, InstancedBufferAttribute, PlaneGeometry,
  MeshLambertMaterial, Matrix4, Vector3, Quaternion, DynamicDrawUsage, ShaderMaterial, AdditiveBlending, DataTexture, UniformsUtils, UniformsLib,
  type Texture,
} from 'three';
import {
  AD, AD_SLOTS, AD_STRIDE, AD_SIZE, AD_SIZES, AD_PALETTES, AD_ICONS, HOUSE_ADS, unpackLook, adSeed, adWear, adAge, hash2, screenTurns, isScreenSlot, TICKS_PER_HOUR,
  type CampaignDTO, type AdSize, type ScreenTurn,
} from '@msimcity/shared';
import { sceneUniforms } from './materials';
import { SIGN_FADE_START, SIGN_FADE_JITTER, SIGN_FADE_LEN } from './signs';
import { FAR_AT } from './buildings';

/**
 * Posters on the ad slots of buildings (docs/adverts.md section 5), modelled on the name boards (signs.ts).
 *
 * - **One InstancedMesh** of quads for every rented slot in the loaded chunks: one draw call. Empty slots are a frame in
 *   the building's own model (shared buildings/adslot.ts), so nothing is drawn for them.
 * - **Near tier**: within the signs' fade (SIGN_FADE_START plus a hashed per-poster jitter) a poster shows its artwork;
 *   past it the same quad shows the campaign's main colour as a flat tint, and past FAR_AT nothing.
 * - **The ad atlas**: one 2048² canvas. Each campaign gets a 256² block drawn once (a landscape cell for billboards and
 *   hoardings, a portrait one for posters and panels, a tall one for banners); the bottom row holds 16 graffiti tags, four
 *   crews' styles, drawn at start-up. No canvas work after a campaign's first sight.
 * - **Wear in the shader**: each instance carries its wear (0-1), a seed and flags. The fragment shader fades and
 *   yellows the paper, tears it where a seeded noise falls under the wear, and lays one tag, then a second, over it once
 *   the wear passes seeded points. Wear comes from the shared formula (adWear) and is refreshed once a game hour
 *   (`refreshWear`): a few hundred floats into one attribute. Nothing runs per frame but the shader.
 * - **Every poster differs** (the organic-effects rule): wear rate (the seed's 0.7-1.3x), the tags and where they sit,
 *   the tear pattern, the crew (the area's), and a slight tilt and offset on the wall.
 * - Billboards and shelter panels are lit at night; paper on walls is not.
 *
 * **Big screens** (docs/adverts.md section 9: the Piccadilly Lights, the big screens corner) go in the same mesh with the
 * SCREEN flag. They are drawn whether rented or not, from the start of the near tier to well past FAR_AT. A building's
 * screens share a ring of turns (shared screenTurns: the renting campaigns, house adverts, the news), packed into the
 * instance's aRect as atlas codes; the shader steps each panel on through the ring every AD.screenSecs of the wall clock
 * (`uWall`), so every viewer sees the same rotation and nothing is sent. Scanlines, an LED grain close up, a wipe between
 * turns, full brightness at night. Organic: each panel has its own phase offset, brightness, wipe direction, slow drift
 * across its picture, and now and then a glitch of its own (a frozen frame, colour bars, a blue error screen, a torn
 * picture). A second, additive mesh (`glow`) gives each panel a soft halo in the air and a pool of its colour on the
 * ground in front, faint by day and strong at night: the colour thrown on the fog.
 */

const ATLAS = 2048, BLOCK = 256, COLS = ATLAS / BLOCK, ROWS = 7;
const MAX_CELLS = COLS * ROWS;
const TAG_W = 128, TAG_H = 64, TAG_Y = ROWS * BLOCK;
/** the house adverts and the news card (big screens' unrented turns): a row of 256×128 cells under the tags */
const HOUSE_Y = TAG_Y + TAG_H, NEWS_CELL = 7;
/** the news card's ticker before any headline is set, and the longest headline it shows before cutting it with an ellipsis */
const NEWS_TICKER = 'Traffic flowing on Piccadilly · Fountain drained for cleaning', NEWS_CHARS = 60;
const MAX_ADS = 4096, MAX_GLOWS = 1024;
/** flags (aAd.w): bit 0 lit at night, bit 1 a free slot highlighted while picking, bits 2-3 the area's crew, bit 4 a big screen */
const LIT = 1, PICK = 2, SCREEN = 16;
/** atlas codes of a screen's turns (aRect, three to a float): 0-55 a campaign's block, 56 + n house advert n, 63 the news */
const HOUSE_CODE = 56, NEWS_CODE = 56 + NEWS_CELL, MAX_TURNS = 9;
/** the wall clock the screens turn on, wrapped at a whole number of every ring's cycle (lcm 1-9 × the turn) */
const WALL_WRAP = AD.screenSecs * 2520;
/** screens show from anywhere a chunk is loaded */
const SCREEN_FAR = 900;

/** One campaign's cells: [u0, v0, du, dv] for the landscape, portrait and banner shapes, and its main colour. */
interface Cells { L: number[]; P: number[]; B: number[]; tint: [number, number, number]; block: number }

const SANS = '"Helvetica Neue", Arial, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
const TAG_FONTS = ['Impact, "Arial Black", sans-serif', '"Marker Felt", "Comic Sans MS", cursive', '"Chalkduster", "Trebuchet MS", sans-serif', '"Arial Black", Impact, sans-serif'];
const TAG_WORDS = ['ZEK', 'KRU', 'OI!', 'NOVA', 'DUB', 'RAZE', 'MOX', 'FLO', 'KAY', 'YUP', 'SKRT', 'ACE', 'PLUM', 'JINX', 'REM', 'BOZ'];
/** crews' colours (docs/adverts.md section 6): fill, outline */
const CREWS: [string, string][][] = [
  [['#111111', '#e03a3a'], ['#e03a3a', '#111111'], ['#111111', '#ffffff'], ['#d42e2e', '#ffd9d9']],
  [['#ff4fa8', '#ffffff'], ['#ffffff', '#ff4fa8'], ['#b33ad9', '#ffffff'], ['#ff78c4', '#2a0f22']],
  [['#7ad321', '#103d10'], ['#c4f53b', '#1a3a12'], ['#2fa84a', '#e9ffd6'], ['#9bff4f', '#000000']],
  [['#4fb6ff', '#0b2440'], ['#cfd8e6', '#2b3d63'], ['#2a6fdb', '#ffffff'], ['#9be0ff', '#14273f']],
];

const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); };

/** The ad atlas: campaign blocks drawn on first sight, graffiti tags drawn once. */
class AdAtlas {
  readonly texture: CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cells = new Map<number, Cells & { block: number; sig: string }>();
  private free: number[] = [];

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    this.g = canvas.getContext('2d')!;
    for (let i = MAX_CELLS - 1; i >= 0; i--) this.free.push(i);
    this.drawTags();
    this.drawHouse();
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 8;
    this.texture = t;
  }

  /** The campaign's cells, drawing its block the first time (or again if its look or words changed). */
  cellsOf(c: CampaignDTO, ownerName: string, ownerColour: number): Cells | null {
    const sig = `${c.look}|${c.text}|${ownerName}`;
    const had = this.cells.get(c.id);
    if (had && had.sig === sig) return had;
    const block = had?.block ?? this.free.pop();
    if (block === undefined) return null;
    const bx = (block % COLS) * BLOCK, by = Math.floor(block / COLS) * BLOCK;
    this.drawCampaign(bx, by, c, ownerName, ownerColour);
    const pal = AD_PALETTES[unpackLook(c.look).palette];
    const rgb = parseInt(pal.bg.slice(1), 16);
    const cells = {
      L: this.uv(bx, by, 256, 128), P: this.uv(bx, by + 128, 96, 128), B: this.uv(bx + 96, by + 128, 48, 128),
      tint: [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255] as [number, number, number], block, sig,
    };
    this.cells.set(c.id, cells);
    this.texture.needsUpdate = true;
    return cells;
  }
  /** Give back the blocks of campaigns that have ended. */
  retain(ids: Set<number>) {
    for (const [id, c] of this.cells) if (!ids.has(id)) { this.cells.delete(id); this.free.push(c.block); }
  }

  private uv(x: number, y: number, w: number, h: number): number[] {
    const i = 1.5; // half a texel and more in, so mips do not bleed from the next cell
    return [(x + i) / ATLAS, 1 - (y + h - i) / ATLAS, (w - 2 * i) / ATLAS, (h - 2 * i) / ATLAS];
  }

  private drawCampaign(bx: number, by: number, c: CampaignDTO, owner: string, ownerColour: number) {
    const g = this.g, { layout, icon, palette } = unpackLook(c.look), pal = AD_PALETTES[palette];
    const own = '#' + (ownerColour >>> 0).toString(16).padStart(6, '0').slice(-6);
    g.clearRect(bx, by, BLOCK, BLOCK);
    const panel = (x: number, y: number, w: number, h: number, shape: 'L' | 'P' | 'B') => {
      g.save();
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.translate(x, y);
      g.fillStyle = pal.bg; g.fillRect(0, 0, w, h);
      // the layouts: a bold slab of colour with a big icon, a diagonal banner across, or a framed classic
      if (layout === 1) {
        g.fillStyle = pal.accent; g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.38); g.lineTo(w, h * 0.58); g.lineTo(0, h * 0.82); g.closePath(); g.fill();
      } else if (layout === 2) {
        g.strokeStyle = pal.accent; g.lineWidth = Math.max(2, w * 0.03); g.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      } else {
        g.fillStyle = pal.accent; g.fillRect(0, h - Math.max(8, h * 0.13), w, Math.max(8, h * 0.13));
      }
      const serif = layout === 2;
      const textBox = (tx: number, ty: number, tw: number, th: number, size: number) => this.text(c.text, tx, ty, tw, th, size, pal.ink, serif);
      if (shape === 'L') {
        this.icon(AD_ICONS[icon], h * 0.42, h * 0.46, h * 0.32, pal.accent, pal.ink);
        textBox(h * 0.85, h * 0.1, w - h * 0.95, h * 0.62, 30);
        this.owner(owner, own, w - 6, h - 4, Math.max(9, h * 0.09), layout === 0 ? pal.bg : pal.ink, 'right');
      } else if (shape === 'P') {
        this.icon(AD_ICONS[icon], w / 2, h * 0.22, w * 0.2, pal.accent, pal.ink);
        textBox(w * 0.08, h * 0.38, w * 0.84, h * 0.44, 18);
        this.owner(owner, own, w / 2, h - 3, 9, layout === 0 ? pal.bg : pal.ink, 'center');
      } else {
        this.icon(AD_ICONS[icon], w / 2, h * 0.14, w * 0.3, pal.accent, pal.ink);
        // a banner: the words run down it, one per line
        textBox(w * 0.06, h * 0.28, w * 0.88, h * 0.6, 12);
      }
      g.restore();
    };
    panel(bx, by, 256, 128, 'L');
    panel(bx, by + 128, 96, 128, 'P');
    panel(bx + 96, by + 128, 48, 128, 'B');
  }

  /** The claim, wrapped onto as few lines as fit, as big as fits. */
  private text(s: string, x: number, y: number, w: number, h: number, max: number, ink: string, serif: boolean) {
    const g = this.g, family = serif ? SERIF : SANS;
    const words = s.split(' ');
    for (let px = max; px >= 7; px--) {
      g.font = `bold ${px}px ${family}`;
      const lines: string[] = [];
      let line = '';
      for (const wd of words) {
        const t = line ? `${line} ${wd}` : wd;
        if (g.measureText(t).width <= w || !line) line = t; else { lines.push(line); line = wd; }
      }
      if (line) lines.push(line);
      const lh = px * 1.08;
      if (lines.length * lh > h || lines.some((l) => g.measureText(l).width > w)) continue;
      g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => g.fillText(l, x + w / 2, y0 + i * lh));
      return;
    }
  }
  /** The renter's name, small, in their colour on a chip. */
  private owner(name: string, colour: string, x: number, y: number, px: number, ink: string, align: CanvasTextAlign) {
    const g = this.g;
    g.font = `bold ${Math.round(px)}px ${SANS}`; g.textAlign = align; g.textBaseline = 'bottom';
    const w = g.measureText(name).width;
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.fillStyle = colour; g.fillRect(x0 - 5, y - px - 1, 3, px);
    g.fillStyle = ink; g.fillText(name, x, y);
  }
  /** A simple icon from the fixed set, centred at x, y, radius r. */
  private icon(kind: string, x: number, y: number, r: number, fill: string, ink: string) {
    const g = this.g;
    g.save(); g.translate(x, y); g.fillStyle = fill; g.strokeStyle = ink; g.lineWidth = Math.max(1.5, r * 0.12); g.lineJoin = 'round';
    g.beginPath();
    switch (kind) {
      case 'house': g.moveTo(-r, 0); g.lineTo(0, -r); g.lineTo(r, 0); g.lineTo(r * 0.75, 0); g.lineTo(r * 0.75, r); g.lineTo(-r * 0.75, r); g.lineTo(-r * 0.75, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.18, r * 0.35, r * 0.36, r * 0.65); break;
      case 'coin': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = ink; g.font = `bold ${Math.round(r * 1.3)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, r * 0.06); break;
      case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.stroke(); break;
      case 'tree': g.arc(0, -r * 0.25, r * 0.7, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.12, r * 0.3, r * 0.24, r * 0.7); break;
      case 'clock': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r * 0.65); g.moveTo(0, 0); g.lineTo(r * 0.5, r * 0.2); g.stroke(); break;
      case 'compass': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.fillStyle = ink; g.moveTo(0, -r * 0.8); g.lineTo(r * 0.25, 0); g.lineTo(0, r * 0.8); g.lineTo(-r * 0.25, 0); g.closePath(); g.fill(); break;
      case 'heart': g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.35); g.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.1, 0, r * 0.9); g.fill(); g.stroke(); break;
      default: g.moveTo(-r, -r * 0.2); g.lineTo(0, -r * 0.7); g.lineTo(r, -r * 0.2); g.lineTo(0, r * 0.3); g.closePath(); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.5, r * 0.05, r, r * 0.45); // a mortarboard
    }
    g.restore();
  }

  /**
   * The big screens' own art for turns nobody rents (shared HOUSE_ADS): generic brands, each a bold landscape card, and
   * the news card ("LIVE · Civitas News") the media centre will replace with the helicopter's picture (AdvertsView.setNewsFeed).
   */
  private drawHouse() {
    const g = this.g, H = 128, W = 256;
    const card = (i: number, bg: string | CanvasGradient, draw: (g: CanvasRenderingContext2D) => void) => {
      g.save(); g.translate(i * W, HOUSE_Y); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      g.fillStyle = bg; g.fillRect(0, 0, W, H); draw(g); g.restore();
    };
    const word = (t: string, x: number, y: number, px: number, ink: string, font = SANS, align: CanvasTextAlign = 'center', weight = 'bold') => {
      g.font = `${weight} ${px}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = ink; g.fillText(t, x, y);
    };
    const lin = (a: string, b: string, vertical = false) => { const gr = g.createLinearGradient(0, 0, vertical ? 0 : W, vertical ? H : 0); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
    HOUSE_ADS.forEach((name, i) => {
      switch (i) {
        case 0: card(i, lin('#d3141c', '#8e0b10'), () => { // a fizzy drink: a swoosh, bubbles, the name in script
          g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.beginPath(); g.moveTo(-10, 100); g.bezierCurveTo(80, 60, 160, 130, 270, 70); g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.55)'; for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(20 + ((k * 53) % 220), 18 + ((k * 37) % 50), 2 + (k % 4), 0, 7); g.fill(); }
          word(name, W / 2, 50, 56, '#ffffff', SERIF, 'center', 'italic bold'); word('Ice cold. Since 1886.', W / 2, 110, 13, '#ffe0e0'); }); break;
        case 1: card(i, lin('#0b1d4d', '#2a6fdb'), () => { // a phone: the handset and a cloud
          g.fillStyle = '#0e0e12'; g.fillRect(22, 14, 52, 100); g.fillStyle = lin('#ff7ac8', '#7ad3ff', true); g.fillRect(26, 20, 44, 86);
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(150, 46, 16, 0, 7); g.arc(170, 40, 20, 0, 7); g.arc(192, 48, 14, 0, 7); g.fill();
          word(name, 170, 84, 30, '#ffffff'); word('The new N7. Out now.', 170, 108, 12, '#cfe3ff'); }); break;
        case 2: card(i, '#0f2a4a', () => { // a bank: a gold coin and a serif name
          g.fillStyle = '#d8b25a'; g.beginPath(); g.arc(52, 64, 34, 0, 7); g.fill(); word('C', 52, 66, 40, '#0f2a4a', SERIF);
          word(name, 166, 54, 26, '#ffffff', SERIF); word('Here for the city', 166, 86, 13, '#d8b25a'); }); break;
        case 3: card(i, lin('#4b1d6e', '#7d3fa0'), () => { // a railway: speed stripes and a star
          for (let k = 0; k < 4; k++) { g.fillStyle = ['#ffd23f', '#ff8c3a', '#ffffff', '#5ec8f2'][k]; g.fillRect(0, 86 + k * 8, W, 4); }
          word(`★ ${name}`, W / 2, 46, 30, '#ffffff'); }); break;
        case 4: card(i, '#2f7d4f', () => { // tea: a kettle and a steam curl
          g.fillStyle = '#fdf6e3'; g.beginPath(); g.ellipse(58, 76, 30, 26, 0, 0, 7); g.fill(); g.fillRect(84, 66, 22, 8); g.fillRect(48, 46, 20, 6);
          g.strokeStyle = '#fdf6e3'; g.lineWidth = 3; g.beginPath(); g.moveTo(108, 60); g.bezierCurveTo(118, 40, 100, 30, 112, 12); g.stroke();
          word(name, 180, 56, 28, '#fdf6e3', SERIF); word('Put the kettle on', 180, 88, 13, '#f2c230'); }); break;
        case 5: card(i, '#0a0a0f', () => { // noodles in neon: a glowing outline
          g.shadowColor = '#ff3fb4'; g.shadowBlur = 14; word(name.split(' ')[0].toUpperCase(), W / 2, 44, 40, '#ff6fd0');
          g.shadowColor = '#3fd8ff'; word(name.split(' ')[1].toUpperCase(), W / 2, 90, 34, '#7fe8ff'); g.shadowBlur = 0; }); break;
        default: card(i, '#ffcf33', () => { // a mobile network: big type on yellow
          word(name.toUpperCase(), W / 2, 50, 30, '#1d1d1d', '"Arial Black", Impact, sans-serif'); word('5G everywhere you go', W / 2, 92, 15, '#1d1d1d'); });
      }
    });
    this.drawNews(this.headline = NEWS_TICKER);
  }

  /** The headline on the news card's ticker now (setNewsHeadline). */
  private headline = '';
  /**
   * The news card: dark studio blue, a skyline with a helicopter over it, the LIVE bug and the ticker with `ticker` on it,
   * cut to NEWS_CHARS with an ellipsis and set as large as fits (12 px down to 8). Redraws only its own cell.
   */
  private drawNews(ticker: string) {
    const g = this.g, H = 128, W = 256;
    const word = (t: string, x: number, y: number, px: number, ink: string, align: CanvasTextAlign = 'center') => {
      g.font = `bold ${px}px ${SANS}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = ink; g.fillText(t, x, y);
    };
    g.save(); g.translate(NEWS_CELL * W, HOUSE_Y); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0c1a33'); sky.addColorStop(1, '#1b3a6b');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#26456f'; for (let k = 0; k < 16; k++) { const h = 18 + ((k * 29) % 44); g.fillRect(k * 16, 104 - h, 14, h); }
    g.fillStyle = '#ffd23f'; for (let k = 0; k < 40; k++) g.fillRect(4 + ((k * 37) % 248), 100 - ((k * 23) % 50), 2, 3);
    g.fillStyle = '#0a0a0a'; g.beginPath(); g.ellipse(178, 34, 14, 6, 0, 0, 7); g.fill(); g.fillRect(186, 32, 22, 3); g.fillRect(160, 25, 36, 2); g.fillRect(176, 27, 2, 4);
    g.fillStyle = '#d42020'; g.fillRect(10, 10, 52, 22); word('LIVE', 36, 22, 16, '#ffffff');
    word('Civitas News', 128, 58, 22, '#ffffff');
    g.fillStyle = '#c8282e'; g.fillRect(0, 106, W, 22);
    let t = ticker.length > NEWS_CHARS ? `${ticker.slice(0, NEWS_CHARS - 1).trimEnd()}…` : ticker;
    let px = 12;
    const fits = () => { g.font = `bold ${px}px ${SANS}`; return g.measureText(t).width <= W - 12; };
    while (px > 8 && !fits()) px--;
    while (t.length > 1 && !fits()) t = `${t.slice(0, -2).trimEnd()}…`;
    word(t, 6, 117, px, '#ffffff', 'left');
    g.restore();
  }
  /** Put a headline on the news card's ticker (empty: the card's own line). Skipped when it has not changed; a change re-uploads the atlas, so it should be rare. */
  setNewsHeadline(text: string) {
    const t = text.trim() || NEWS_TICKER;
    if (t === this.headline) return;
    this.headline = t;
    this.drawNews(t);
    this.texture.needsUpdate = true;
  }
  /** A house or news cell's rect, for the panel's preview (same layout as uv()). */
  houseRect(n: number): number[] { return this.uv(n * BLOCK, HOUSE_Y, 256, 128); }

  /** 16 tags in a strip along the bottom: four per crew, each a word in a crew's colours with an outline, a swoosh and a drip. */
  private drawTags() {
    const g = this.g;
    for (let i = 0; i < 16; i++) {
      const crew = Math.floor(i / 4), [fill, line] = CREWS[crew][i % 4], r = rng(i * 7919 + 13);
      const x0 = i * TAG_W, y0 = TAG_Y;
      g.save();
      g.beginPath(); g.rect(x0, y0, TAG_W, TAG_H); g.clip();
      g.translate(x0 + TAG_W / 2, y0 + TAG_H / 2);
      g.rotate((r() - 0.5) * 0.35);
      const word = TAG_WORDS[(i * 5 + crew) % TAG_WORDS.length];
      const px = 30 + Math.floor(r() * 10);
      g.font = `${crew === 1 ? 'italic ' : ''}${px}px ${TAG_FONTS[crew]}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = line; g.strokeText(word, 0, -2);
      g.fillStyle = fill; g.fillText(word, 0, -2);
      // a swoosh under it and a drip or two
      g.lineCap = 'round'; g.strokeStyle = fill; g.lineWidth = 3 + r() * 2;
      g.beginPath(); g.moveTo(-44 + r() * 10, 18); g.quadraticCurveTo(0, 26 + r() * 6, 46 - r() * 10, 12 + r() * 6); g.stroke();
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) { const dx = (r() - 0.5) * 50; g.lineWidth = 2; g.beginPath(); g.moveTo(dx, 6); g.lineTo(dx, 14 + r() * 14); g.stroke(); }
      g.restore();
    }
  }
}

/** A building with slots, as chunkView placed it: its design key, world matrix, door tile and the parcel at the door. */
export interface AdHostItem { key: string; matrix: Matrix4; door: [number, number]; parcel: number }
/** A rental as the client keeps it (shared AD_RENTAL). */
export interface RentalView { campaign: number; age: number; rate: number; at: number; placed: number; size: number }

const tmpM = new Matrix4(), local = new Matrix4(), tilt = new Matrix4(), flat = new Matrix4();
const tmpQ = new Quaternion(), tmpV = new Vector3(), tmpS = new Vector3(), tmpP = new Vector3();

/** A screen's ring as atlas codes, packed three to a float (6 bits each) into aRect.xyz; .w is the ring's length + 16 × the panel's place in it. */
function packRing(codes: number[], k: number): number[] {
  const out = [0, 0, 0, codes.length + 16 * k];
  codes.slice(0, MAX_TURNS).forEach((c, j) => { out[Math.floor(j / 3)] += c * 64 ** (j % 3); });
  return out;
}
const turnCode = (t: ScreenTurn, block: (c: number) => number | null): number =>
  t.kind === 'news' ? NEWS_CODE : t.kind === 'house' ? HOUSE_CODE + t.art : block(t.campaign) ?? HOUSE_CODE + (t.campaign % HOUSE_ADS.length);

/** GLSL shared by the poster and glow shaders: a screen turn's atlas rect from its code, and the code of turn j of a ring. */
const SCREEN_GLSL = /* glsl */ `
vec4 adCellRect(float code) {
  float x, y;
  if (code < ${(HOUSE_CODE - 0.5).toFixed(1)}) { x = mod(code, ${COLS.toFixed(1)}) * ${BLOCK.toFixed(1)}; y = floor(code / ${COLS.toFixed(1)}) * ${BLOCK.toFixed(1)}; }
  else { x = (code - ${HOUSE_CODE.toFixed(1)}) * 256.0; y = ${HOUSE_Y.toFixed(1)}; }
  return vec4((x + 1.5) / ${ATLAS.toFixed(1)}, 1.0 - (y + 126.5) / ${ATLAS.toFixed(1)}, 253.0 / ${ATLAS.toFixed(1)}, 125.0 / ${ATLAS.toFixed(1)});
}
float adRingCode(vec4 ring, float j) {
  float f = j < 2.5 ? ring.x : j < 5.5 ? ring.y : ring.z;
  return mod(floor(f / pow(64.0, mod(j, 3.0))), 64.0);
}
float adHash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// where a panel is in its ring now: x the turn, y the one before, z seconds into this turn, w the step (for glitches)
vec4 adScreenTurn(vec4 ring, float seed, float wall) {
  float n = max(1.0, mod(ring.w, 16.0)), k = floor(ring.w / 16.0);
  float t = wall + seed * 1.9;
  float st = floor(t / ${AD.screenSecs.toFixed(1)});
  return vec4(mod(k + st, n), mod(k + st - 1.0 + n, n), t - st * ${AD.screenSecs.toFixed(1)}, st);
}`;

/** The screens' wall clock, shared by both materials and set once a frame (flush). */
const wallUniform = { value: 0 };
/** The news feed (setNewsFeed): a texture every news turn shows instead of the placeholder card, and whether one is set. */
const newsUniform = { value: new DataTexture(new Uint8Array([12, 26, 51, 255]), 1, 1) as Texture }, newsLiveUniform = { value: 0 };
newsUniform.value.needsUpdate = true;

/** The instanced posters for every loaded chunk. */
export class AdvertsView {
  readonly mesh: InstancedMesh;
  /** the big screens' halos and the pools of colour they throw on the ground (additive; a child of `mesh`) */
  readonly glow: InstancedMesh;
  private atlas = new AdAtlas();
  private rect: InstancedBufferAttribute;
  private ad: InstancedBufferAttribute;
  private tint: InstancedBufferAttribute;
  private gRing: InstancedBufferAttribute;
  private gAd: InstancedBufferAttribute;
  private hosts = new Map<string, AdHostItem[]>();
  /**
   * per chunk: matrices, rects, ad (wear, seed, fade start, flags), tints, and what each instance is for (for the hourly
   * wear); and the screens' glows: matrices, rings, (seed, halo 0 or pool 1)
   */
  private perChunk = new Map<string, { m: Float32Array; r: Float32Array; a: Float32Array; t: Float32Array; refs: { k: string; seed: number }[]; n: number; gm: Float32Array; gr: Float32Array; ga: Float32Array; gn: number }>();
  private dirty = false;
  private rentals = new Map<string, RentalView>();
  private campaigns = new Map<number, CampaignDTO>();
  private hour = -1;
  /** free slots glow while the Campaigns panel is picking (`setPicking`) */
  private picking = false;
  /** a renter's name and colour, from the players list (main.ts) */
  owner: (id: string) => { name: string; color: number } = (id) => ({ name: id, color: 0x888888 });
  /** whether a free slot can be seen from the street (shared adSlotOpen, against the client's tiles), for the picking glow */
  open: (door: [number, number], i: number) => boolean = () => true;
  /** the server tick now, for the wear */
  tick: () => number = () => 0;

  constructor() {
    const mat = new MeshLambertMaterial({ map: this.atlas.texture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = sceneUniforms.uNight;
      sh.uniforms.uTime = sceneUniforms.uTime;
      sh.uniforms.uWall = wallUniform;
      sh.uniforms.uNews = newsUniform;
      sh.uniforms.uNewsLive = newsLiveUniform;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 aRect;
attribute vec4 aAd;
attribute vec3 aTint;
varying vec2 vAdUv;
varying vec4 vAd;
varying vec3 vTint;
varying vec4 vRing;
varying float vFade;
varying float vDist;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = aRect.xy + uv * aRect.zw;
vAdUv = uv;
vRing = aRect;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 sp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vDist = distance(sp.xyz, cameraPosition);
  vFade = 1.0 - smoothstep(aAd.z, aAd.z + ${SIGN_FADE_LEN.toFixed(1)}, vDist);
  vAd = aAd; vTint = aTint;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uTime;
uniform float uWall;
uniform sampler2D uNews;
uniform float uNewsLive;
varying vec2 vAdUv;
varying vec4 vAd;
varying vec3 vTint;
varying vec4 vRing;
varying float vFade;
varying float vDist;
${SCREEN_GLSL}
float adHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float adNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(adHash(i), adHash(i + vec2(1.0, 0.0)), f.x), mix(adHash(i + vec2(0.0, 1.0)), adHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
// one graffiti tag (crew c, tag t of four) laid over the poster at a seeded spot; returns its colour and cover
vec4 adTag(vec2 uv, float crew, float t, float s) {
  vec2 size = vec2(0.36 + 0.2 * fract(s * 7.3), 0.22 + 0.12 * fract(s * 3.1));
  vec2 pos = vec2(fract(s * 13.7) * (1.0 - size.x), 0.08 + fract(s * 5.9) * (0.84 - size.y));
  vec2 q = (uv - pos) / size;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  float idx = crew * 4.0 + t;
  vec2 tuv = vec2((idx * ${TAG_W.toFixed(1)} + 2.0 + q.x * ${(TAG_W - 4).toFixed(1)}) / ${ATLAS.toFixed(1)}, 1.0 - (${TAG_Y.toFixed(1)} + 2.0 + (1.0 - q.y) * ${(TAG_H - 4).toFixed(1)}) / ${ATLAS.toFixed(1)});
  return texture2D(map, tuv);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float adScreenGlow = 0.0;
if (vAd.w >= ${SCREEN.toFixed(1)}) {
  // a big screen: this panel's turn of the ring, from the wall clock
  float seed = vAd.y;
  vec4 tt = adScreenTurn(vRing, seed, uWall);
  float code = adRingCode(vRing, tt.x), prev = adRingCode(vRing, tt.y), into = tt.z;
  // a slow drift across the picture, each panel its own way
  float drift = into / ${AD.screenSecs.toFixed(1)};
  vec2 dir = vec2(fract(seed * 7.1) - 0.5, fract(seed * 3.3) - 0.5) * 0.06;
  vec2 uv = (vAdUv - 0.5) * (1.0 - 0.05 * drift) + 0.5 + dir * drift;
  vec4 r = adCellRect(code), rp = adCellRect(prev);
  vec3 col = texture2D(map, r.xy + uv * r.zw).rgb;
  if (code > ${(NEWS_CODE - 0.5).toFixed(1)} && uNewsLive > 0.5) col = texture2D(uNews, vAdUv).rgb;
  // the wipe from the turn before, across or down as this panel does it
  float wipeT = smoothstep(0.0, 0.45, into);
  float axis = fract(seed * 5.7) < 0.5 ? vAdUv.x : 1.0 - vAdUv.y;
  if (axis > wipeT) col = texture2D(map, rp.xy + vAdUv * rp.zw).rgb;
  col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.08, abs(axis - wipeT))) * step(into, 0.45);
  // now and then a glitch, its own kind and moment: a frozen frame, colour bars, the blue screen or a torn picture
  float g = adHash1(tt.w * 1.37 + seed * 91.0);
  if (g < 0.04) {
    float at = fract(g * 53.0) * 6.0, len = 0.2 + fract(g * 97.0) * 1.2;
    if (into > at && into < at + len) {
      float kind = floor(fract(g * 211.0) * 4.0);
      if (kind < 0.5) col = texture2D(map, rp.xy + vAdUv * rp.zw).rgb * vec3(1.0, 0.85, 1.1);
      else if (kind < 1.5) col = vec3(step(0.5, fract(vAdUv.x * 3.5)), step(0.5, fract(vAdUv.x * 1.75 + 0.25)), step(0.5, fract(vAdUv.x * 7.0))) * 0.85;
      else if (kind < 2.5) col = mix(vec3(0.05, 0.2, 0.75), vec3(0.9), step(0.6, vAdUv.y) * step(vAdUv.y, 0.68) * step(0.1, vAdUv.x) * step(vAdUv.x, 0.75));
      else { float band = floor(vAdUv.y * 9.0); col = texture2D(map, r.xy + vec2(fract(vAdUv.x + (adHash1(band + tt.w) - 0.5) * 0.3), vAdUv.y) * r.zw).rgb; }
    }
  }
  // scanlines and an LED grain close up, fading with distance so far screens do not shimmer
  float nearK = 1.0 - smoothstep(3.0, 18.0, vDist);
  col *= 1.0 - 0.16 * nearK * (0.5 + 0.5 * sin(vAdUv.y * 220.0));
  col *= 1.0 - 0.1 * (1.0 - smoothstep(0.5, 3.0, vDist)) * (0.5 + 0.5 * sin(vAdUv.x * 900.0));
  // each panel's own brightness, a slow breath, a darker rim at the bezel
  float edge = min(min(vAdUv.x, 1.0 - vAdUv.x), min(vAdUv.y, 1.0 - vAdUv.y));
  col *= (0.86 + 0.24 * fract(seed * 13.3)) * (0.97 + 0.03 * sin(uTime * 0.7 + seed * 40.0)) * (0.8 + 0.2 * smoothstep(0.0, 0.03, edge));
  if (mod(vAd.w, 4.0) >= 2.0) { float pulse = 0.55 + 0.45 * sin(uTime * 5.0 + seed * 6.0); col = mix(col, vec3(1.0, 0.86, 0.25), 0.35 + 0.25 * pulse); }
  adScreenGlow = 1.0;
  diffuseColor = vec4(col * 0.3, 1.0);
  totalEmissiveRadiance += col * (0.75 + 0.45 * uNight);
  if (vDist > ${SCREEN_FAR.toFixed(1)}) discard;
} else {
  float wear = vAd.x, seed = vAd.y, flags = vAd.w;
  float crew = mod(floor(flags / 4.0), 4.0);
  vec2 uv = vAdUv;
  vec3 col = diffuseColor.rgb;
  // the sun and rain: faded, yellowed, a little grey
  float age = smoothstep(0.05, 0.95, wear);
  col = mix(col, col * 0.8 + vec3(0.12, 0.1, 0.03), 0.8 * age);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.3 * age);
  // grime streaks from the top, each poster its own
  float streak = adNoise(vec2(uv.x * 9.0 + seed * 31.0, uv.y * 1.5)) * smoothstep(0.4, 1.0, uv.y + 0.2);
  col *= 1.0 - 0.25 * age * streak;
  // tags: the first once wear passes a seeded point, the second later
  float t1 = 0.22 + 0.22 * fract(seed * 17.0), t2 = 0.5 + 0.2 * fract(seed * 29.0);
  if (wear > t1) { vec4 g = adTag(uv, crew, floor(fract(seed * 3.7) * 4.0), seed * 1.91 + 0.13); col = mix(col, g.rgb, g.a * smoothstep(t1, t1 + 0.04, wear)); }
  if (wear > t2) { vec4 g = adTag(uv, crew, floor(fract(seed * 8.3) * 4.0), seed * 4.77 + 0.61); col = mix(col, g.rgb, g.a * smoothstep(t2, t2 + 0.04, wear)); }
  // tears: the paper comes away from the edges first, in a pattern of its own, showing the old paste and paper behind
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float n = adNoise(uv * vec2(6.0, 8.0) + seed * 43.0) * 0.7 + adNoise(uv * vec2(17.0, 21.0) + seed * 11.0) * 0.3;
  float tear = (wear - 0.42) * 1.5 - (n * 0.6 + edge * 1.4);
  if (tear > 0.0) col = mix(vec3(0.80, 0.78, 0.71), vec3(0.62, 0.60, 0.55), adNoise(uv * 30.0 + seed)) * (0.9 + 0.1 * n);
  // far away: the campaign's colour as a flat tint
  col = mix(vTint * 0.9, col, vFade);
  // picking (the Campaigns panel): a free frame glows and pulses
  if (mod(flags, 4.0) >= 2.0) {
    float pulse = 0.55 + 0.45 * sin(uTime * 5.0 + seed * 6.0);
    float rim = 1.0 - smoothstep(0.0, 0.12, edge);
    col = mix(vec3(1.0, 0.86, 0.25) * (0.5 + 0.5 * pulse), vec3(1.0, 0.95, 0.6), rim);
  }
  diffuseColor = vec4(col, 1.0);
  if (vDist > ${FAR_AT.toFixed(1)}) discard;
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (adScreenGlow < 0.5) {
  float lit = mod(vAd.w, 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * lit * uNight * 0.8 * vFade;
  if (mod(vAd.w, 4.0) >= 2.0) totalEmissiveRadiance += diffuseColor.rgb * 0.6;
}`);
    };
    const geo = new PlaneGeometry(1, 1);
    this.rect = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 4), 4).setUsage(DynamicDrawUsage);
    this.ad = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 4), 4).setUsage(DynamicDrawUsage);
    this.tint = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 3), 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('aRect', this.rect);
    geo.setAttribute('aAd', this.ad);
    geo.setAttribute('aTint', this.tint);
    this.mesh = new InstancedMesh(geo, mat, MAX_ADS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    // the screens' glow: a soft halo in the air before each panel and a pool of its colour on the ground, in the colour
    // of the turn it shows (the cell's average, read from a small mip in the vertex shader); faint by day, strong at night
    const gmat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uMap: { value: null }, uNight: { value: 0 }, uWall: { value: 0 } }]),
      vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform sampler2D uMap;
uniform float uWall;
uniform float uNight;
attribute vec4 aRing;
attribute vec2 aGlow;
varying vec2 vUv;
varying vec3 vCol;
varying float vPool;
${SCREEN_GLSL}
void main() {
  vUv = uv; vPool = aGlow.y;
  vec4 tt = adScreenTurn(aRing, aGlow.x, uWall);
  vec4 r = adCellRect(adRingCode(aRing, tt.x));
  vec3 c = textureLod(uMap, r.xy + r.zw * 0.5, 5.0).rgb * 0.6 + textureLod(uMap, r.xy + r.zw * vec2(0.25, 0.5), 5.0).rgb * 0.2 + textureLod(uMap, r.xy + r.zw * vec2(0.75, 0.5), 5.0).rgb * 0.2;
  float k = (0.12 + 0.88 * uNight) * (0.85 + 0.3 * fract(aGlow.x * 17.0)) * smoothstep(0.0, 0.45, tt.z);
  vCol = c * k * 1.1;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
varying vec3 vCol;
varying float vPool;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0;
  float a;
  // the halo spills above and below its panel only (over the panel itself, or a neighbour's, it would wash the picture
  // out); the pool is brightest at the wall and fades out across the street
  if (vPool < 0.5) { float dy = max(q.y - ${(1 / 2.6).toFixed(3)}, 0.0) / ${(1 - 1 / 2.6).toFixed(3)}; a = step(${(1 / 2.6).toFixed(3)}, q.y) * exp(-dy * 3.5) * 0.24 * (1.0 - smoothstep(0.6, 1.0, q.x)); }
  else { a = (1.0 - smoothstep(0.25, 1.0, q.x)) * pow(vUv.y, 1.4) * 0.42 * (1.0 - smoothstep(0.94, 1.0, vUv.y)); }
  vec3 c = vCol * a;
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  #ifdef USE_FOG
    c *= 1.0 - 0.6 * smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    gmat.uniforms.uMap.value = this.atlas.texture;
    gmat.uniforms.uWall = wallUniform;
    gmat.uniforms.uNight = sceneUniforms.uNight;
    const ggeo = new PlaneGeometry(1, 1);
    this.gRing = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 4), 4).setUsage(DynamicDrawUsage);
    this.gAd = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 2), 2).setUsage(DynamicDrawUsage);
    ggeo.setAttribute('aRing', this.gRing);
    ggeo.setAttribute('aGlow', this.gAd);
    this.glow = new InstancedMesh(ggeo, gmat, MAX_GLOWS);
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 4;
    this.mesh.add(this.glow);
  }

  /**
   * The news hooks (docs/adverts.md section 9, shared screenTurns). The headline: the latest story's text on the
   * "LIVE · Civitas News" card's ticker (the media centre's story log calls it when the latest story changes; empty puts
   * the card's own line back), cut at 60 characters; only the news cell is redrawn, and an unchanged text costs nothing.
   */
  setNewsHeadline(text: string) { this.atlas.setNewsHeadline(text); }

  /**
   * The picture: every 'news' turn on every big screen shows this texture (the news helicopter's render target, media
   * N4, UTD 90cd3857) in place of the card; null puts the card back. Costs nothing until set: the screens sample it only
   * on their news turn.
   */
  setNewsFeed(tex: Texture | null) {
    newsLiveUniform.value = tex ? 1 : 0;
    if (tex) newsUniform.value = tex;
  }

  /** The campaigns and rentals (the `ads` message): every chunk's posters again. */
  setAds(campaigns: CampaignDTO[], r: number[], stride: number) {
    this.campaigns = new Map(campaigns.map((c) => [c.id, c]));
    this.rentals.clear();
    for (let i = 0; i + stride <= r.length; i += stride) this.rentals.set(`${r[i]},${r[i + 1]}#${r[i + 2]}`, { campaign: r[i + 3], age: r[i + 4], rate: r[i + 5], at: r[i + 6], placed: r[i + 7], size: r[i + 8] ?? 1 });
    this.atlas.retain(new Set(this.campaigns.keys()));
    for (const key of this.hosts.keys()) this.build(key);
  }
  rental(x: number, y: number, i: number) { return this.rentals.get(`${x},${y}#${i}`); }
  campaign(id: number) { return this.campaigns.get(id); }
  campaignList(): CampaignDTO[] { return [...this.campaigns.values()]; }
  /** every rental as `x,y#slot` and its state */
  rentalEntries(): IterableIterator<[string, RentalView]> { return this.rentals.entries(); }

  /** Light up the free frames (picking slots in the Campaigns panel), or stop. */
  setPicking(on: boolean) {
    if (on === this.picking) return;
    this.picking = on;
    for (const key of this.hosts.keys()) this.build(key);
  }

  /** One chunk's buildings that have slots (render/buildings.ts calls it with every chunk it places). */
  setChunk(key: string, items: AdHostItem[]) {
    if (!items.length) { this.clear(key); return; }
    this.hosts.set(key, items);
    this.build(key);
  }
  clear(key: string) {
    this.hosts.delete(key);
    if (this.perChunk.delete(key)) this.dirty = true;
  }

  private build(key: string) {
    const items = this.hosts.get(key) ?? [];
    const m: number[] = [], r: number[] = [], a: number[] = [], t: number[] = [], refs: { k: string; seed: number }[] = [];
    const gm: number[] = [], gr: number[] = [], ga: number[] = [];
    const now = this.tick();
    for (const it of items) {
      const slots = AD_SLOTS[it.key];
      if (!slots) continue;
      // a building's big screens: one ring of turns for all of them (shared screenTurns)
      const screens: number[] = [];
      for (let i = 0; i * AD_STRIDE < slots.length; i++) if (isScreenSlot(slots, i)) screens.push(i);
      const ring = screens.length ? screenTurns(screens.map((i) => this.rentals.get(`${it.door[0]},${it.door[1]}#${i}`)?.campaign ?? null), hash2(it.door[0] * 13 + 5, it.door[1] * 7 + 1))
        .map((turn) => turnCode(turn, (id) => { const c = this.campaigns.get(id), own = c ? this.owner(c.owner) : null; return c && own ? this.atlas.cellsOf(c, own.name, own.color)?.block ?? null : null; })) : [];
      for (let i = 0; i * AD_STRIDE < slots.length; i++) {
        const k = `${it.door[0]},${it.door[1]}#${i}`;
        const rent = this.rentals.get(k);
        const free = !rent && this.picking && this.open(it.door, i);
        const screen = screens.indexOf(i);
        if (!rent && !free && screen < 0) continue;
        const o = i * AD_STRIDE, size = AD_SIZES[slots[o + 1]] as AdSize, face = slots[o];
        const seed = screen >= 0 ? hash2(it.door[0] * 31 + i * 7 + 3, it.door[1] * 17 + 11) : adSeed(it.door[0], it.door[1], i, rent?.campaign ?? 0);
        let rect = [0, 0, 0, 0], tint: [number, number, number] = [1, 0.85, 0.3];
        if (screen >= 0) rect = packRing(ring, screen);
        else if (rent) {
          const c = this.campaigns.get(rent.campaign);
          const own = c ? this.owner(c.owner) : null;
          const cells = c && own ? this.atlas.cellsOf(c, own.name, own.color) : null;
          if (!cells) continue;
          const shape = AD_SIZE[size].cell;
          rect = [...cells[shape]];
          if (size === 'hoarding') { rect[1] += rect[3] / 6; rect[3] *= 2 / 3; } // 3:1 from the 2:1 cell's middle band
          tint = cells.tint;
        }
        // where: the slot's centre turned to its wall (a screen on a curve: its own way), a hair of seeded tilt and offset
        // for paper, the poster's size (not stretched with a site's fence)
        it.matrix.decompose(tmpP, tmpQ, tmpS);
        const u = Math.min(tmpS.x, tmpS.y, tmpS.z), along = face === 0 ? tmpS.x : tmpS.z;
        const jx = screen >= 0 ? 0 : (hash2(i * 13 + 7, it.door[0] * 3 + it.door[1]) - 0.5) * 0.008, jy = screen >= 0 ? 0 : (hash2(it.door[1] * 5 + i, it.door[0] + 11) - 0.5) * 0.006;
        local.makeRotationY(slots[o + 7]);
        tilt.makeRotationZ(screen >= 0 ? 0 : (seed - 0.5) * 0.05);
        local.multiply(tilt);
        local.scale(tmpV.set((slots[o + 5] * u) / (screen >= 0 ? tmpS.x : along), (slots[o + 6] * u) / tmpS.y, 1));
        const lx = slots[o + 2] + (face === 0 ? jx : 0), lz = slots[o + 4] + (face === 0 ? 0 : jx);
        local.setPosition(lx, slots[o + 3] + jy, lz);
        tmpM.multiplyMatrices(it.matrix, local);
        m.push(...tmpM.elements);
        r.push(...rect);
        const crew = Math.floor(hash2(it.parcel * 7 + 3, 19) * 4);
        const wear = rent && screen < 0 ? adWear(adAge(rent.age, rent.rate, rent.at, now), seed) : 0;
        const fade = screen >= 0 ? SCREEN_FAR * 2 : SIGN_FADE_START + (hash2(it.door[0] * 3 + 11 + i, it.door[1] * 5 + 2) - 0.5) * 2 * SIGN_FADE_JITTER;
        a.push(wear, seed, fade, (AD_SIZE[size].lit ? LIT : 0) + (free ? PICK : 0) + crew * 4 + (screen >= 0 ? SCREEN : 0));
        t.push(...tint);
        refs.push({ k: rent && screen < 0 ? k : '', seed });
        if (screen >= 0) {
          // its halo, a little in front and bigger than the panel, and its pool of light on the ground before it
          local.makeRotationY(slots[o + 7]);
          local.scale(tmpV.set(slots[o + 5], slots[o + 6] * 2.6, 1));
          const nx = Math.sin(slots[o + 7]), nz = Math.cos(slots[o + 7]);
          local.setPosition(slots[o + 2] + nx * 0.03, slots[o + 3], slots[o + 4] + nz * 0.03);
          gm.push(...tmpM.multiplyMatrices(it.matrix, local).elements);
          gr.push(...rect); ga.push(seed, 0);
          const reach = 0.5 + slots[o + 3] * 1.6;
          local.makeRotationY(slots[o + 7]);
          flat.makeRotationX(-Math.PI / 2);
          local.multiply(flat);
          local.scale(tmpV.set(slots[o + 5] * 2.2, reach, 1));
          local.setPosition(slots[o + 2] + nx * (reach / 2 + 0.01), 0.026 + i * 0.0004, slots[o + 4] + nz * (reach / 2 + 0.01));
          gm.push(...tmpM.multiplyMatrices(it.matrix, local).elements);
          gr.push(...rect); ga.push(seed, 1);
        }
      }
    }
    this.perChunk.set(key, { m: new Float32Array(m), r: new Float32Array(r), a: new Float32Array(a), t: new Float32Array(t), refs, n: refs.length, gm: new Float32Array(gm), gr: new Float32Array(gr), ga: new Float32Array(ga), gn: ga.length / 2 });
    this.dirty = true;
  }

  /** Once a game hour (or when asked): every poster's wear from the shared formula. A few hundred floats, never per frame. */
  refreshWear(force = false) {
    const now = this.tick(), hour = Math.floor(now / TICKS_PER_HOUR);
    if (!force && hour === this.hour) return;
    this.hour = hour;
    for (const c of this.perChunk.values()) for (let j = 0; j < c.n; j++) {
      const ref = c.refs[j], rent = ref.k ? this.rentals.get(ref.k) : undefined;
      if (rent) c.a[j * 4] = adWear(adAge(rent.age, rent.rate, rent.at, now), ref.seed);
    }
    this.dirty = true;
  }

  /** Pack every chunk's posters into the instance buffers, once a frame at most. */
  flush() {
    wallUniform.value = (Date.now() / 1000) % WALL_WRAP; // the screens' clock: one uniform, the same on every viewer's machine
    this.refreshWear();
    if (!this.dirty) return;
    this.dirty = false;
    const im = this.mesh.instanceMatrix.array as Float32Array, ra = this.rect.array as Float32Array, aa = this.ad.array as Float32Array, ta = this.tint.array as Float32Array;
    const gim = this.glow.instanceMatrix.array as Float32Array, gra = this.gRing.array as Float32Array, gaa = this.gAd.array as Float32Array;
    let n = 0, g = 0;
    for (const c of this.perChunk.values()) {
      const gt = Math.min(c.gn, MAX_GLOWS - g);
      if (gt) {
        gim.set(c.gm.subarray(0, gt * 16), g * 16);
        gra.set(c.gr.subarray(0, gt * 4), g * 4);
        gaa.set(c.ga.subarray(0, gt * 2), g * 2);
        g += gt;
      }
      if (n >= MAX_ADS) continue;
      const take = Math.min(c.n, MAX_ADS - n);
      if (!take) continue; // most chunks have no posters
      im.set(c.m.subarray(0, take * 16), n * 16);
      ra.set(c.r.subarray(0, take * 4), n * 4);
      aa.set(c.a.subarray(0, take * 4), n * 4);
      ta.set(c.t.subarray(0, take * 3), n * 3);
      n += take;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rect.needsUpdate = true;
    this.ad.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.glow.count = g;
    this.glow.visible = g > 0;
    this.glow.instanceMatrix.needsUpdate = true;
    this.gRing.needsUpdate = true;
    this.gAd.needsUpdate = true;
  }

  get count() { return this.mesh.count; }
  /** The hosts in a chunk (the panel's picking and the nearest free slot). */
  hostsIn(key: string): readonly AdHostItem[] { return this.hosts.get(key) ?? []; }
  allHosts(): IterableIterator<AdHostItem[]> { return this.hosts.values(); }
}
