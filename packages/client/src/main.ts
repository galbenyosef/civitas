import { WebGLRenderer, Scene, Mesh, PlaneGeometry, MeshBasicMaterial, Fog, PCFSoftShadowMap, ACESFilmicToneMapping, Quaternion, Vector3 } from 'three';
import {
  CHUNK_SIZE, LAND_PRICE_PER_TILE, TICKS_PER_DAY, TICK_MS, Terrain, KIND_NAMES, Zone, isCivicId, stopModeOf, kindIdOf, kindManifest, hasFeature,
  terrainOf, isRoad, zoneOf, levelOf, underConstruction, checkPurchase, planStructure, FRONT_NAMES, planRunway, isAirfieldAux, isRailAux, hash2, trainCrew, flightManifest, flightPassengers, TRAIN_VMAX, type Flight, type FlightManifest, type TrainInfo, type PlaceVerdict, type Placed, type RunwayPlan, type LandRect, chunkKey, parseKey, localIndex, type Tool, type BuildingInfo, type CitizenInfo,
} from '@msimcity/shared';
import { NetClient } from './net';
import { LocalGame, AUTOJOIN } from './local/client';
import { mountLocalUi, localLogin, addPlayOffline, registerServiceWorker } from './local/ui';
import { ClientWorld } from './world';
import { CameraRig } from './camera';
import { ChunkView } from './render/chunkView';
import { ParcelsView } from './render/parcels';
import { CitizensView } from './render/citizens';
import { ParkedCars } from './render/parkedCars';
import { TrafficLights } from './render/signals';
import { ParksView } from './render/parks';
import { PlanesView } from './render/planes';
import { HelicoptersView } from './render/helicopters';
import { AirfieldView } from './render/airfield';
import { TrainsView } from './render/trains';
import { RailClient, trainHtml } from './rail';
import { RouteView } from './render/route';
import { JunctionView } from './render/junctions';
import { BridgeView } from './render/bridges';
import { LandmarkMotion } from './render/landmarks';
import { FootprintOverlay } from './render/footprint';
import { Fpv, type CabEye } from './render/fpv';
import { vehicleKey, trainPanelHtml, trainKmh, planePanelHtml, planeTipHtml, planeDoing, planeKnots, planeFeet, heliTipHtml, heliPanelHtml, heliDoing, heliTitle, heliKnots, type VehicleSel } from './vehicles';
import { Buildings } from './render/buildings';
import { Lighting } from './render/lighting';
import { buildAtlas } from './render/atlas';
import { buildingMaterial, groundMaterial as makeGroundMaterial, sceneUniforms } from './render/materials';
import { Input, DEV_TOOLS, structureTool, type Rect, type ToolId } from './input';
import { UI } from './ui';
import { ContextMenu } from './contextmenu';
import { Onboarding } from './onboarding';
import { LinesPanel } from './lines';
import { PerfHud } from './render/perfhud';
import { WorldPicker, startCity, showCityBanner, reviveCity, testCityOf, cityWsHost, remembered } from './worlds';
import { demoOf, demoWsUrl, startDemo, reviveDemo, showDemoBanner, TourPanel } from './tour';

// ---- renderer & scene ---------------------------------------------------------------------
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new Scene();
scene.fog = new Fog(0x9fc4e8, 120, 420);
const lighting = new Lighting(scene);
const rig = new CameraRig(1);
const world = new ClientWorld();

const atlas = buildAtlas();
atlas.anisotropy = renderer.capabilities.getMaxAnisotropy();
const groundMaterial = makeGroundMaterial(atlas);
const buildings = new Buildings(buildingMaterial());
const views = new Map<string, ChunkView>();
const parcelsView = new ParcelsView();
const citizens = new CitizensView();
const lights = new TrafficLights();
const routeView = new RouteView();
scene.add(buildings.mesh, parcelsView.group, citizens.group, lights.group, routeView.group);
const parked = new ParkedCars(world); scene.add(parked.group);
const parks = new ParksView(); // trees and benches inside park tiles
scene.add(parks.group);

const hoverMesh = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
hoverMesh.visible = false;
const rectMesh = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x62d2a2, transparent: true, opacity: 0.35, depthWrite: false }));
rectMesh.visible = false;
scene.add(hoverMesh, rectMesh);
const footprint = new FootprintOverlay(); // outline, door arrow and marks of the structure being placed or hovered
scene.add(footprint.group);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  rig.resize(w / h);
}
window.addEventListener('resize', resize);
resize();

// ---- url params: ?name= skips login, ?at=x,y&dist=n places the camera, ?hour=h freezes lighting ---
const params = new URLSearchParams(location.search);
const at = params.get('at')?.split(',').map(Number);
if (at && at.length === 2 && at.every(Number.isFinite)) rig.target.set(at[0], 0, at[1]);
if (params.get('dist')) rig.dist = Number(params.get('dist'));
if (params.get('hour')) { lighting.mode = 'fixed'; lighting.fixedHour = Number(params.get('hour')); }
// ?fx=0|1|2 pins shadow quality; otherwise it adapts to frame time
const fxParam = params.get('fx');
if (fxParam !== null) lighting.setQuality(Number(fxParam));
let frameAvg = 16, qualityTimer = 0;
function adaptQuality(dt: number) {
  if (fxParam !== null) return;
  frameAvg += (dt * 1000 - frameAvg) * 0.05;
  qualityTimer += dt;
  if (qualityTimer < 2) return;
  qualityTimer = 0;
  if (frameAvg > 50 && lighting.quality > 0) lighting.setQuality(lighting.quality - 1);
  else if (frameAvg < 18 && lighting.quality < 2) lighting.setQuality(lighting.quality + 1);
}

// ---- networking ---------------------------------------------------------------------------
// a demo map (?demo=<id>, tour.ts) is reached through this server's /demo-ws/<id>, which pipes to the demo's process
const demoParam = demoOf(params);
/** the guided tour, in a demo */
let tour: TourPanel | null = null;
const wsUrl = params.get('ws') ? `ws://${params.get('ws')}` : demoParam ? demoWsUrl(demoParam) : (import.meta.env.VITE_WS_URL
  ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.port === '5173' ? `${location.hostname}:8080` : location.host}`);
/** local mode (docs/local-mode.md): the game runs in a worker in this tab and saves to IndexedDB; ?local, or always in the static build */
const local = __LOCAL_ONLY__ || params.has('local') ? new LocalGame({ devTools: params.has('dev') }) : null;
const net = local ? new NetClient(() => local.socket()) : new NetClient(wsUrl);
let selectedParcel = 0;
/** tile of the building whose people panel is open, if any */
let selectedBuilding: [number, number] | null = null;
let panelShown = 0;
let onlineCount = 0;
/** the game clock as of the last stats message; `rate` is game ticks per TICK_MS (0 while a local game is paused, 2 or 4 fast) */
const clock = { day: 0, frac: 0.5, at: performance.now(), rate: 1 };
/** game days since the last stats message */
const sinceStats = () => ((performance.now() - clock.at) * clock.rate) / (TICKS_PER_DAY * TICK_MS);
const liveHour = () => ((clock.frac + sinceStats()) % 1) * 24;
/** The server's tick as of now, interpolated from the last stats message (signal phases are a pure function of it). */
const liveTick = () => Math.floor((clock.day + clock.frac + sinceStats()) * TICKS_PER_DAY);
/** the same, fractional, for smooth interpolation of planes */
const liveTickF = () => (clock.day + clock.frac + sinceStats()) * TICKS_PER_DAY;
// planes fly from every operational airport in the loaded chunks (render/airfield.ts derives them from tiles);
// ?airport=x,y,dir[,gates[,flightsPerHour]] adds a preview at a placeholder airfield on open land (dir 0 E, 1 W, 2 S, 3 N)
const planes = new PlanesView();
const airfield = new AirfieldView();
scene.add(planes.group, airfield.group);
// helicopters fly between the helipads on the buildings in the loaded chunks (render/helicopters.ts, shared/src/helicopters.ts)
const helis = new HelicoptersView();
scene.add(helis.group);
// trains run every line the server sends (render/trains.ts); the track tool's preview and tooltips (client/src/rail.ts)
const trains = new TrainsView();
const rail = new RailClient(world);
scene.add(trains.group, rail.group);
const junctions = new JunctionView(world); scene.add(junctions.group); // roundabout islands, flyover decks and ramps
const bridges = new BridgeView(world); scene.add(bridges.group); // bridge decks, piers, towers and ramps (render/bridges.ts)
citizens.roadY = (x, z, hx, hz) => junctions.roadY(x, z, hx, hz) || bridges.roadY(x, z, hx, hz); // cars and walkers on a flyover deck or a bridge and their ramps
const landmarks = new LandmarkMotion(); scene.add(landmarks.group); // the London Eye turning, Big Ben's dials (render/landmarks.ts)
landmarks.auxAt = (x, y) => world.auxAt(x, y); // a Tower Bridge span running on into the next chunk
const airportParam = params.get('airport')?.split(',').map(Number);
if (airportParam && airportParam.length >= 3 && airportParam.every((n) => Number.isFinite(n))) {
  planes.setPreviews([{ id: 1, x: airportParam[0], y: airportParam[1], dir: (airportParam[2] & 3) as 0 | 1 | 2 | 3, gates: airportParam[3] || 3, runwayLen: 12, flightsPerHour: airportParam[4] || 2 }]);
}
/** Does this junction tile's parcel owner have the Traffic signals technology? */
const signalled = (x: number, y: number) => {
  const p = world.parcelAt(x, y);
  const owner = p && world.players.get(p.owner);
  return !!owner && hasFeature(owner.tech, 'signals');
};

let selectedCitizen = 0;
let following = false;
/** the selected train or plane (vehicles.ts); exclusive with selectedCitizen */
let selectedVehicle: VehicleSel | null = null;
/** the server's last full answer about the selected train */
let trainInfo: TrainInfo | null = null;
const ui = new UI({
  onTool: (t) => input.setTool(t),
  onTax: (id, taxRate) => net.send({ t: 'parcel', id, taxRate }),
  onRename: (id, name) => net.send({ t: 'parcel', id, name }),
  onPriority: (x, y, priority) => net.send({ t: 'priority', x, y, priority }),
  onFocus: (x, y) => { following = false; rig.target.set(x + 0.5, 0, y + 0.5); rig.dist = Math.min(rig.dist, 30); },
  onUnlock: (id) => net.send({ t: 'unlock', id }),
  onFollow: (_id, on) => setFollow(on),
  onDeselectCitizen: () => (selectedVehicle ? selectVehicle(null) : selectCitizen(0)),
  onSelectCitizen: (id) => selectCitizen(id),
  onFpv: (mode) => { if (mode === 'inset') fpv.toggleInset(); else fpv.toggleFull(); },
  onCloseBuilding: () => closeBuilding(),
});

net.onStatus = (ok) => { ui.setConn(ok); if (!ok) subscribed.clear(); };
net.on('welcome', (m) => {
  world.me = m.you;
  world.sandbox = !!m.sandbox;
  world.applyPlayers(m.players);
  world.applyParcels(m.parcels);
  const me = world.myPlayer!;
  ui.setWho(me.name, me.color);
  ui.setMoney(me.money, me.ledger);
  ui.setLocks(me.tech);
  ui.hideLogin();
  for (const key of [...views.keys()]) dropView(key);
  subscribed.clear();
  streamChunks();
});
net.on('chunk', (m) => {
  const key = chunkKey(m.chunk.cx, m.chunk.cy);
  if (!subscribed.has(key)) return;
  world.putChunk(m.chunk);
  if (!views.has(key)) {
    const v = new ChunkView(m.chunk.cx, m.chunk.cy, groundMaterial);
    views.set(key, v);
    scene.add(v.group);
  }
});
net.on('aux', (m) => world.applyAux(m.u));
net.on('sub', (m) => world.applySub(m.u));
net.on('tiles', (m) => world.applyTiles(m.u));
net.on('parcels', (m) => { world.applyParcels(m.parcels, m.removed); lights.invalidate(); refreshPanel(); });
net.on('players', (m) => {
  lights.invalidate();
  world.applyPlayers(m.players);
  onlineCount = m.players.filter((p) => p.online).length;
  const me = world.myPlayer; if (me) { ui.setMoney(me.money, me.ledger); ui.setLocks(me.tech); ui.showTech(me); devPanel?.sync(!!me.devUnlimited); }
  world.parcelsDirty = true; refreshPanel();
});
net.on('citizens', (m) => citizens.update(m.c, performance.now()));
// bus lines (client/src/lines.ts): the lines chip and panel, ribbons while it is open, and each bus's livery
const lines = new LinesPanel(net, world, (kind, msg) => ui.toast(kind, msg), liveTick);
lines.onLivery = (pairs, colours) => citizens.setLivery(pairs, colours);
lines.onEdit = () => input.setTool('select');
scene.add(lines.group);
net.on('lines', (m) => lines.apply(m));
net.on('lineStats', (m) => lines.applyStats(m));
net.on('traffic', (m) => world.applyTraffic(m.cx, m.cy, m.d, m.k));
net.on('stats', (m) => {
  clock.day = m.day; clock.frac = m.dayFrac; clock.at = performance.now(); clock.rate = m.rate ?? 1;
  ui.setClock(m.day, m.dayFrac);
  ui.setWorldStats(m, local ? -1 : onlineCount); // -1: a local game has no one else online
});
net.on('toast', (m) => ui.toast(m.kind, m.msg));
// onboarding goals, advisor hints and the tech chip's pulse (onboarding.ts)
const onboarding = new Onboarding({ net, world, liveTick, tool: (t) => input.setTool(t as ToolId), toast: (k, msg) => ui.toast(k, msg),
  focus: (x, y) => { following = false; rig.target.set(x + 0.5, 0, y + 0.5); rig.dist = Math.min(Math.max(rig.dist, 30), 60); }, openTech: () => { ui.toggleTech(true); ui.showTech(world.myPlayer); } });
ui.onHint = (id) => onboarding.hint(id);
net.on('railLines', (m) => { trains.setLines(m.lines); rail.setLines(m.lines); });
net.on('sitelist', (m) => {
  const p = world.parcels.get(m.id);
  if (p && m.id === selectedParcel) ui.showSites(m.id, m.sites, world.mayEdit(p.owner));
});
setInterval(() => { if (selectedParcel && !selectedBuilding && net.connected) net.send({ t: 'sites', id: selectedParcel }); }, 2000);

// ---- chunk streaming ----------------------------------------------------------------------
const subscribed = new Set<string>();
const STREAM_MIN_R = 1, STREAM_MAX_R = 6; // chunks either side of the camera target's chunk
/**
 * How far the fog reaches, as a chunk radius: grows with zoom-out and when the camera is tilted toward the horizon.
 * This used to be the streaming radius too; the fog keeps it so the look is unchanged, and streaming now follows
 * what the camera can actually see inside that fog (streamWindow).
 */
function fogRadius() {
  const low = rig.pitch < 0.6 ? 1 : 0;
  return Math.min(STREAM_MAX_R, Math.max(2, Math.ceil(rig.dist / 35) + 1 + low));
}
function fogFar() {
  return Math.min(rig.dist * 4.5 + 140, fogRadius() * CHUNK_SIZE + rig.dist * Math.cos(rig.pitch));
}
/**
 * Chunks to keep loaded: the ground footprint of the view (the four corner rays hitting the ground, cut off where
 * the fog is opaque), plus one chunk of margin all round (two when tilted toward the horizon), clamped to at least
 * STREAM_MIN_R and at most fogRadius() (never more than STREAM_MAX_R) chunks either side of the target's chunk, so
 * it is never bigger than the old fixed square. Worked out from yaw/pitch/dist rather than the camera matrices so
 * it is current even between frames.
 */
function streamWindow(): { cx0: number; cx1: number; cy0: number; cy1: number } {
  const cam = rig.camera;
  const t = Math.tan((cam.fov * Math.PI) / 360), a = cam.aspect;
  const sp = Math.sin(rig.pitch), cp = Math.cos(rig.pitch);
  const height = rig.dist * sp, back = rig.dist * cp, far = fogFar();
  const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
  let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
  for (const v of [-1, 1]) for (const u of [-1, 1]) {
    // corner ray in camera space is (u·t·a, v·t, -1): its depth is the ray parameter, which fog is measured in
    const down = sp - v * t * cp;
    const s = Math.min(far, down > 1e-6 ? height / down : far);
    const f = s * (cp + v * t * sp) - back, l = s * u * t * a; // forward / right of the target on the ground
    const x = fx * f + rx * l, z = fz * f + rz * l;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const m = CHUNK_SIZE * (rig.pitch < 0.6 ? 2 : 1);
  const tx = rig.target.x, tz = rig.target.z;
  const ccx = Math.floor(tx / CHUNK_SIZE), ccy = Math.floor(tz / CHUNK_SIZE);
  const rMax = Math.min(STREAM_MAX_R, fogRadius());
  const clampLo = (c: number, cc: number) => Math.min(cc - STREAM_MIN_R, Math.max(cc - rMax, c));
  const clampHi = (c: number, cc: number) => Math.max(cc + STREAM_MIN_R, Math.min(cc + rMax, c));
  return {
    cx0: clampLo(Math.floor((tx + x0 - m) / CHUNK_SIZE), ccx), cx1: clampHi(Math.floor((tx + x1 + m) / CHUNK_SIZE), ccx),
    cy0: clampLo(Math.floor((tz + z0 - m) / CHUNK_SIZE), ccy), cy1: clampHi(Math.floor((tz + z1 + m) / CHUNK_SIZE), ccy),
  };
}
function streamChunks() {
  if (!net.connected) return;
  const win = streamWindow();
  const want = new Set<string>();
  for (let cy = win.cy0; cy <= win.cy1; cy++) for (let cx = win.cx0; cx <= win.cx1; cx++) want.add(chunkKey(cx, cy));
  const add: [number, number][] = [], drop: [number, number][] = [];
  for (const k of want) if (!subscribed.has(k)) { subscribed.add(k); add.push(parseKey(k)); }
  for (const k of subscribed) if (!want.has(k)) { subscribed.delete(k); drop.push(parseKey(k)); dropView(k); }
  if (add.length) net.send({ t: 'sub', chunks: add });
  if (drop.length) net.send({ t: 'unsub', chunks: drop });
}
function dropView(key: string) {
  const v = views.get(key);
  if (v) { scene.remove(v.group); v.dispose(); views.delete(key); }
  buildings.clear(key);
  lights.dropChunk(key);
  parks.dropChunk(key);
  airfield.dropChunk(key);
  helis.dropChunk(key);
  trains.dropChunk(key);
  junctions.dropChunk(key);
  bridges.dropChunk(key);
  landmarks.dropChunk(key);
  world.dropChunk(key);
}
setInterval(streamChunks, 300);

// ---- input ------------------------------------------------------------------------------------
const input = new Input(canvas, rig, {
  onToolChange: (t) => { ui.setTool(t); rectMesh.visible = false; updateStatus(); },
  ladderKey: (t) => ui.ladderKey(t), // 0, 8, 9, Y, P, G, V, B, L open their size picker on the size last used
  isWater: (x, y) => { const t = world.getTile(x, y); return t !== undefined && terrainOf(t) === Terrain.Water; }, // the road tool bridges water (render/bridges.ts)
  onBuild: (tool, tiles) => {
    const rot = structureTool(tool) ? input.rotationOf(tool) : undefined; // the orientation chosen with Z/C, else the server faces a road itself
    net.send({ t: 'build', tool: tool as Tool, tiles, ...(rot !== undefined ? { rot } : {}), ...(DEV_TOOLS ? { dev: true } : {}) });
  },
  onRotate: (tool, dir) => {
    // the first press starts from the orientation the preview currently shows (auto-chosen or not); later presses turn the chosen one
    const auto = placeMemo && placeMemo.kind === structureTool(tool) ? placeMemo.v.placed?.r : undefined;
    input.setRotation(tool, (input.rotationOf(tool) ?? auto ?? 0) + dir + 4);
    placeMemo = null;
    updateStatus();
  },
  onBuy: (r: Rect) => { net.send({ t: 'buy', ...r }); rectMesh.visible = false; },
  onContext: (px, py, cx, cy) => {
    if (lines.undoStop()) return; // editing a bus line: a right-click takes the last stop off
    // right-click (not a drag): the menu of whatever is under the cursor, agents first like a left click
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const id = citizens.pick(px, py, rig.camera, w, h);
    if (id) { ctxMenu.open({ k: 'agent', id }, cx, cy); return; }
    const tr = trains.pick(px, py, rig.camera, w, h);
    if (tr) { ctxMenu.open({ k: 'train', ...tr }, cx, cy); return; }
    const pl = planes.pick(px, py, rig.camera, w, h);
    if (pl) { ctxMenu.open({ k: 'plane', ...pl }, cx, cy); return; }
    const hl = helis.pick(px, py, rig.camera, w, h);
    if (hl !== null) { ctxMenu.open({ k: 'heli', flight: hl }, cx, cy); return; }
    const tile = input.tileAt(px, py);
    if (tile) ctxMenu.open({ k: 'tile', x: tile[0], y: tile[1] }, cx, cy);
  },
  onSelect: (x, y, px, py) => {
    if (lines.mapClick(x, y)) return; // editing a bus line: clicked stops join it
    const id = citizens.pick(px, py, rig.camera, canvas.clientWidth, canvas.clientHeight);
    if (id) { selectCitizen(id); return; }
    // trains and planes (vehicles.ts): picked from what was drawn last frame
    const tr = trains.pick(px, py, rig.camera, canvas.clientWidth, canvas.clientHeight);
    if (tr) { selectVehicle({ kind: 'train', ...tr }); return; }
    const pl = planes.pick(px, py, rig.camera, canvas.clientWidth, canvas.clientHeight);
    if (pl) { selectVehicle({ kind: 'plane', ...pl }); return; }
    const hl = helis.pick(px, py, rig.camera, canvas.clientWidth, canvas.clientHeight);
    if (hl !== null) { selectVehicle({ kind: 'heli', flight: hl }); return; }
    selectTile(x, y, 'building');
  },
  onHover: (tile) => { updateStatus(); hoverAt(tile); },
  onKey: (code) => {
    if (code === 'Escape' && selectedBuilding) closeBuilding();
    else if (code === 'KeyH') setHeat(!ChunkView.heatOn);
    else if (code === 'KeyT') { ui.toggleTech(); ui.showTech(world.myPlayer); }
  },
});

/** Select the building on a tile (its people panel), or only the parcel under it (the tax and name panel). */
function selectTile(x: number, y: number, panel: 'building' | 'parcel') {
  [x, y] = world.doorOf(x, y); // a structure is known by its door tile
  const t = world.getTile(x, y);
  const p = world.parcelAt(x, y);
  selectedParcel = p ? p.id : 0;
  world.parcelsDirty = true;
  if (panel === 'building' && t !== undefined && zoneOf(t) !== 0 && !isRoad(t)) {
    selectedBuilding = [x, y];
    ui.showBuilding(PENDING_INFO(x, y, t), selectedCitizen);
    refreshBuilding();
    return;
  }
  closeBuilding(false);
  refreshPanel();
}
function setFollow(on: boolean) { following = on; if (on) { rig.dist = Math.min(rig.dist, 18); } refreshCitizen(); refreshVehicle(); }

// ---- traffic heat overlay and parked cars ----------------------------------------------------
function setHeat(on: boolean) {
  ChunkView.setHeat(on);
  sceneUniforms.uHeat.value = on ? 1 : 0;
  ui.setHeat(on);
}
document.getElementById('heat')!.onclick = () => setHeat(!ChunkView.heatOn);
document.getElementById('techBtn')!.onclick = () => { ui.toggleTech(); ui.showTech(world.myPlayer); };
ui.setHeat(false);
/** Fold fresh traffic bytes into the chunk views and the parked-car instances. */
function applyTrafficUpdates() {
  if (!world.trafficDirty.size) return;
  for (const key of world.trafficDirty) {
    const v = views.get(key);
    if (v) { v.heat = world.traffic.get(key); v.tintRoads(); }
  }
  parked.update(world.trafficDirty);
  world.trafficDirty.clear();
}

// ---- selected citizen: live panel and follow camera -------------------------------------------
/** The selected agent's last answer that carried its route (hover answers for the same agent do not). */
let routeInfo: CitizenInfo | null = null;
/** First-person view (I: inset, O: whole window, Esc leaves the window); render/fpv.ts */
const fpv = new Fpv({
  citizens,
  selected: () => selectedCitizen,
  cab: () => cabEye(),
  notify: (msg) => ui.toast('info', msg),
  onChange: (mode) => {
    ui.markFpv(mode);
    if (mode === 'full') { input.hover = null; ui.hideTip(); rig.dist = Math.min(rig.dist, 30); }
  },
});
function selectCitizen(id: number) {
  clearVehicle(); // a name picked from a train's roster replaces the train
  selectedCitizen = id;
  citizens.selected = id;
  following = false;
  routeInfo = null;
  routeView.clear();
  fpv.retarget();
  if (!id) { ui.hideCitizen(); ui.markPerson(0); return; }
  ui.markPerson(id);
  net.send({ t: 'inspectCitizen', id, route: true });
}
function refreshCitizen() { if (selectedCitizen && net.connected) net.send({ t: 'inspectCitizen', id: selectedCitizen, route: true }); }
setInterval(refreshCitizen, 1000);
net.on('citizen', (m) => {
  if (m.id === selectedCitizen) {
    if (!m.info) { selectCitizen(0); return; }
    let info = m.info;
    if (info.trail || info.route) { routeInfo = info; routeView.set(info); }
    else if (routeInfo) info = { ...info, trail: routeInfo.trail, route: routeInfo.route, legKinds: routeInfo.legKinds, legStarts: routeInfo.legStarts };
    ui.showCitizen(info, following, fpv.mode);
    fpv.setInfo(info);
  }
  if (m.id === tipAgent) {
    if (!m.info) { ui.hideTip(); return; }
    ui.showCitizenTip(m.info);
    ui.moveTip(mouse.x, mouse.y);
  }
});

// ---- right-click menu (contextmenu.ts): what exists for the person, vehicle, building, road or land under the cursor
const ctxMenu = new ContextMenu({
  world, net,
  selectedCitizen: () => selectedCitizen,
  selectedVehicle: () => selectedVehicle,
  following: () => following,
  fpvMode: () => fpv.mode,
  selectAgent: (id) => selectCitizen(id),
  selectVehicle: (v) => selectVehicle(v),
  deselect: () => (selectedVehicle ? selectVehicle(null) : selectCitizen(0)),
  follow: (on) => setFollow(on),
  fpv: (mode) => { if (mode === 'inset') fpv.toggleInset(); else fpv.toggleFull(); },
  selectTile,
  focus: (x, y) => { following = false; rig.target.set(x + 0.5, 0, y + 0.5); rig.dist = Math.min(rig.dist, 30); },
  openLines: () => lines.toggle(true),
  buyVerdict,
  onOpen: () => { clearTimeout(tipTimer); clearInterval(tipRefresh); tipTile = null; tipAgent = 0; ui.hideTip(); },
});

// ---- selected train or plane: panel, follow camera and cab view (vehicles.ts) ------------------------
const UP = new Vector3(0, 1, 0);
const manifests = new Map<string, FlightManifest>();
function manifestOf(airport: number, f: Flight): FlightManifest {
  const k = `${airport}:${f.id}`;
  let m = manifests.get(k);
  if (!m) { const p = flightPassengers(f); m = flightManifest(f, p.arriving, p.departing); if (manifests.size > 64) manifests.clear(); manifests.set(k, m); }
  return m;
}
function clearVehicle() { selectedVehicle = null; trainInfo = null; trains.selected = null; planes.selected = null; helis.selected = null; }
function selectVehicle(v: VehicleSel | null) {
  selectedCitizen = 0; citizens.selected = 0; routeInfo = null; routeView.clear(); ui.markPerson(0);
  following = false;
  clearVehicle();
  selectedVehicle = v;
  if (v?.kind === 'train') trains.selected = { line: v.line, train: v.train };
  if (v?.kind === 'plane') planes.selected = `${v.airport}:${v.flight}`;
  if (v?.kind === 'heli') helis.selected = v.flight;
  fpv.retarget();
  if (!v) { ui.hideCitizen(); return; }
  refreshVehicle();
}
/** Trains ask the server for their riders (a `full` inspect, answered in 'train'); planes are worked out here. */
function refreshVehicle() {
  const v = selectedVehicle;
  if (v?.kind === 'train') { if (net.connected) net.send({ t: 'inspectTrain', line: v.line, train: v.train, full: true }); if (!trainInfo) showTrainPanel(); }
  else if (v?.kind === 'plane') showPlanePanel();
  else if (v?.kind === 'heli') showHeliPanel();
}
setInterval(refreshVehicle, 1000);
function showTrainPanel() {
  const v = selectedVehicle;
  if (v?.kind !== 'train') return;
  const dto = trains.lines.find((l) => l.id === v.line), st = trains.stateOf(v.line, v.train);
  if (!dto || !st) { selectVehicle(null); ui.toast('info', 'That train has gone out of service'); return; }
  const kinds = trains.consistOf(v.line, v.train);
  const crew = trainCrew(v.line, v.train, !!(trainInfo?.freight ?? dto.freight), kinds?.length ?? 0, trains.lastTick);
  ui.showVehicle(vehicleKey(v), trainPanelHtml(dto, st, kinds, trainInfo, crew, selectedCitizen), following, fpv.mode);
}
/** a plane's speed in tiles per tick, from where it is half a tick on */
function planeSpeed(airport: number, flight: number): number {
  const a = planes.stateOf(airport, flight), b = planes.stateOf(airport, flight, planes.lastTick + 0.5);
  return a && b ? Math.hypot(b.s.x - a.s.x, b.s.y - a.s.y, b.s.z - a.s.z) / 0.5 : 0;
}
function showPlanePanel() {
  const v = selectedVehicle;
  if (v?.kind !== 'plane') return;
  const hit = planes.stateOf(v.airport, v.flight);
  if (!hit) { selectVehicle(null); ui.toast('info', 'That plane has left'); return; }
  const m = manifestOf(v.airport, hit.s.flight);
  ui.showVehicle(vehicleKey(v), planePanelHtml(hit.s, m, hit.s.gate, planeKnots(hit.s.type, planeSpeed(v.airport, v.flight))), following, fpv.mode);
}
/** a helicopter's ground speed in tiles per tick, from where it is half a tick on */
function heliSpeed(flight: number): number {
  const a = helis.stateOf(flight), b = helis.stateOf(flight, helis.lastTick + 0.5);
  return a && b ? Math.hypot(b.x - a.x, b.z - a.z) / 0.5 : 0;
}
function showHeliPanel() {
  const v = selectedVehicle;
  if (v?.kind !== 'heli') return;
  const s = helis.stateOf(v.flight);
  if (!s) { selectVehicle(null); ui.toast('info', 'That helicopter has left'); return; }
  ui.showVehicle(vehicleKey(v), heliPanelHtml(s, heliKnots(heliSpeed(v.flight))), following, fpv.mode);
}
/** The selected vehicle's cab for the first-person view, from the pose drawn this frame. */
function cabEye(): CabEye | null {
  const v = selectedVehicle;
  if (!v) return null;
  if (v.kind === 'train') {
    const c = trains.cabOf(v.line, v.train), dto = trains.lines.find((l) => l.id === v.line);
    if (!c || !dto) return null;
    const doing = c.st.phase === 'dwell' ? (c.st.doors ? 'standing · doors open' : 'standing') : trainInfo?.next ? `running to ${trainInfo.next}` : 'running';
    return {
      key: vehicleKey(v), x: c.x, y: c.y, z: c.z, q: new Quaternion().setFromAxisAngle(UP, -c.h),
      label: `Line ${dto.number} · driver's cab`, lines: [doing, `${trainKmh(c.st.v)} km/h`], dip: 0.035, sway: c.st.v / TRAIN_VMAX, seed: hash2(v.line, v.train),
    };
  }
  if (v.kind === 'heli') {
    const s = helis.stateOf(v.flight);
    if (!s) return null;
    const e = helis.cockpitOf(s), kt = heliKnots(heliSpeed(v.flight));
    const title = heliTitle(s).replace(/<span[^>]*>/, '· ').replace(/<[^>]+>/g, '').replace(/^\S+ /, '');
    return {
      key: vehicleKey(v), ...e, label: `${title} · cockpit`,
      lines: [heliDoing(s), `${s.phase !== 'onPad' ? `${planeFeet(s.y).toLocaleString()} ft · ` : ''}${kt} kt`],
      fogFar: 130, dip: s.y - (s.pad?.y ?? 0) > 1 ? 0.14 : 0.06, sway: s.phase === 'onPad' ? 0.15 * s.rotor : 0.45, seed: s.seed,
      instruments: { ktPerTile: heliKnots(1000) / 1000, ftPerTile: planeFeet(100) / 100, ticksPerSec: (1000 / TICK_MS) * clock.rate, tick: helis.lastTick, eyeAbove: e.y - s.y },
    };
  }
  const hit = planes.stateOf(v.airport, v.flight);
  if (!hit) return null;
  const m = manifestOf(v.airport, hit.s.flight), e = planes.cockpitOf(hit.s), kt = planeKnots(hit.s.type, planeSpeed(v.airport, v.flight));
  const outbound = hit.s.phase !== 'approach' && hit.s.phase !== 'flare' && hit.s.phase !== 'rollout' && hit.s.phase !== 'taxiIn' && !(hit.s.phase === 'dwell' && hit.s.progress < 0.5);
  return {
    key: vehicleKey(v), ...e, label: `${outbound ? m.outbound : m.inbound} · ${m.airline} · cockpit`,
    lines: [planeDoing(hit.s, m), `${hit.s.y > 0.05 ? `${planeFeet(hit.s.y).toLocaleString()} ft · ` : ''}${kt} kt`],
    fogFar: 150, dip: hit.s.y > 0.3 ? 0.1 : 0.04, sway: hit.s.y > 0.05 ? 0.6 : 0.2, seed: hit.s.seed,
    instruments: { ktPerTile: planeKnots(hit.s.type, 1000) / 1000, ftPerTile: planeFeet(100) / 100, ticksPerSec: (1000 / TICK_MS) * clock.rate, tick: planes.lastTick, eyeAbove: e.y - hit.s.y },
  };
}
/** where the follow camera looks for the selected vehicle */
function vehiclePos(): [number, number] | null {
  const v = selectedVehicle;
  if (v?.kind === 'train') { const st = trains.stateOf(v.line, v.train); const c = st && trains.cabOf(v.line, v.train); return c ? [c.x, c.z] : null; }
  if (v?.kind === 'plane') { const hit = planes.stateOf(v.airport, v.flight); return hit ? [hit.s.x, hit.s.z] : null; }
  if (v?.kind === 'heli') { const s = helis.stateOf(v.flight); return s ? [s.x, s.z] : null; }
  return null;
}

// ---- dev tools (only with ?dev; the server ignores them unless it is a non-production server) ----------
const devPanel = DEV_TOOLS ? (() => {
  const chip = document.createElement('button');
  chip.className = 'chip'; chip.id = 'devBtn'; chip.textContent = 'dev'; chip.title = 'Testing tools (only on a dev server)';
  document.getElementById('techBtn')!.before(chip);
  const box = document.createElement('div');
  box.id = 'devPanel'; box.className = 'hidden';
  box.innerHTML = `<div class="devhead">Dev tools <span>testing only</span></div>
    <label class="devrow"><input type="checkbox" id="devUnlimited"> Unlimited funds</label>
    <button class="chip" id="devMoney">+ $100,000</button>
    <button class="chip" id="devTech">Unlock all tech</button>
    <div class="devnote">Tech locks are already skipped for building while ?dev is on; unlocking makes the tech tree, growth tiers and patrols match.</div>`;
  document.getElementById('ui')!.appendChild(box);
  chip.onclick = () => { box.classList.toggle('hidden'); chip.classList.toggle('on', !box.classList.contains('hidden')); };
  const unl = box.querySelector<HTMLInputElement>('#devUnlimited')!;
  unl.onchange = () => net.send({ t: 'dev', action: 'unlimited', on: unl.checked });
  box.querySelector<HTMLButtonElement>('#devMoney')!.onclick = () => net.send({ t: 'dev', action: 'money' });
  box.querySelector<HTMLButtonElement>('#devTech')!.onclick = () => net.send({ t: 'dev', action: 'tech' });
  return { sync: (on: boolean) => { unl.checked = on; chip.classList.toggle('warn', on); } };
})() : null;

document.getElementById('light')!.onclick = () => {
  if (lighting.mode === 'live') { lighting.mode = 'fixed'; lighting.fixedHour = 15.5; } else lighting.mode = 'live';
  ui.setLightMode(lighting.mode, lighting.fixedHour);
};
ui.setLightMode(lighting.mode, lighting.fixedHour);

// ---- selected building: people panel ------------------------------------------------------------
/** Placeholder shown for the instant before the server answers the first full inspect. */
const PENDING_INFO = (x: number, y: number, t: number): BuildingInfo => ({ x, y, kind: kindIdOf(zoneOf(t), world.subAt(x, y)), level: levelOf(t), capacity: 0, occupants: 0 });
function refreshBuilding() { if (selectedBuilding && net.connected) net.send({ t: 'inspect', x: selectedBuilding[0], y: selectedBuilding[1], full: true }); }
setInterval(refreshBuilding, 2000);
function closeBuilding(refresh = true) {
  if (!selectedBuilding) return;
  selectedBuilding = null;
  ui.hideBuilding();
  if (refresh) { selectedParcel = 0; world.parcelsDirty = true; refreshPanel(); }
}

function refreshPanel() {
  if (selectedBuilding) return;
  const p = world.parcels.get(selectedParcel);
  if (!p) { ui.hideParcel(); selectedParcel = 0; panelShown = 0; return; }
  ui.showParcel(p, world.players.get(p.owner), world.mayEdit(p.owner));
  if (panelShown !== p.id) { panelShown = p.id; net.send({ t: 'sites', id: p.id }); }
}

/** The server's land purchase rules run on whatever chunks are loaded here; unloaded tiles read as unclaimed. */
let buyMemo: { key: string; at: number; v: ReturnType<typeof checkPurchase> } | null = null;
function buyVerdict(r: Rect) {
  const k = `${r.x},${r.y},${r.w},${r.h}`, now = performance.now();
  if (buyMemo && buyMemo.key === k && now - buyMemo.at < 200) return buyMemo.v;
  const owned: LandRect[] = [];
  for (const q of world.parcels.values()) if (q.owner === world.me) owned.push(q);
  const v = world.sandbox ? { ok: true as const } : checkPurchase(r, world.me, { // a sandbox has no border or islanding rules
    owned,
    ownerAt: (x, y) => world.parcelAt(x, y)?.owner ?? null,
    isWater: (x, y) => { const t = world.getTile(x, y); return t !== undefined && terrainOf(t) === Terrain.Water; },
    ownerName: (id) => world.players.get(id)?.name ?? id,
  });
  buyMemo = { key: k, at: now, v };
  return v;
}

/**
 * Where the hover highlight goes: the planned footprint while a multi-tile tool is active (with the server's
 * placement verdict, worked out on the loaded chunks), the whole structure under the cursor, else the tile.
 */
let placeMemo: { key: string; kind: number; at: number; v: PlaceVerdict } | null = null;
function hoverArea(h: [number, number]): { x: number; y: number; w: number; h: number; verdict?: PlaceVerdict; placed?: Placed; existing?: boolean } {
  const kind = structureTool(input.tool);
  if (kind) {
    const rot = input.rotationOf(input.tool);
    const key = `${kind}:${h[0]},${h[1]}:${rot}`, now = performance.now();
    if (!placeMemo || placeMemo.key !== key || now - placeMemo.at > 200) {
      const draft = !!kindManifest(kind)?.draft;
      placeMemo = { key, kind, at: now, v: planStructure(kind, h[0], h[1], {
        tile: (x, y) => world.getTile(x, y),
        aux: (x, y) => world.auxAt(x, y),
        sub: (x, y) => world.subAt(x, y),
        land: (x, y) => { const p = world.parcelAt(x, y); if (p ? world.mayEdit(p.owner) : draft && DEV_TOOLS) return null; return p ? 'Not your land' : 'Buy this land first'; },
      }, rot) };
    }
    const v = placeMemo.v, p = v.placed;
    return p ? { x: p.ax, y: p.ay, w: p.w, h: p.h, verdict: v, placed: p } : { x: h[0], y: h[1], w: 1, h: 1, verdict: v };
  }
  if (input.tool === 'roundabout' || input.tool === 'flyover') return junctions.hoverArea(input.tool, h);
  if (input.tool === 'road' && input.crossing) {
    // a road dragged out over the water: the bridge it would make, bank to bank
    const c = bridges.crossingPlan(input.crossing, DEV_TOOLS);
    return { x: c.x, y: c.y, w: c.w, h: c.h, verdict: c.plan.ok ? { ok: true } as PlaceVerdict : { ok: false, reason: c.plan.reason ?? '' } };
  }
  if (input.tool === 'runway') {
    const v = runwayVerdict(input.runwayLine ?? [h]);
    const r = v.rect;
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h, verdict: v.ok ? { ok: true } as PlaceVerdict : { ok: false, reason: v.reason ?? '' } } : { x: h[0], y: h[1], w: 1, h: 1, verdict: { ok: false, reason: v.reason ?? '' } };
  }
  const s = world.structureAt(h[0], h[1]);
  return s ? { x: s.ax, y: s.ay, w: s.w, h: s.h, placed: s, existing: true } : { x: h[0], y: h[1], w: 1, h: 1 };
}
/** The server's runway rules on the loaded chunks: snap onto a terminal's runway row, check the strip. */
let runwayMemo: { key: string; at: number; v: RunwayPlan } | null = null;
function runwayVerdict(line: [number, number][]): RunwayPlan {
  const key = line.length ? `${line[0]}|${line[line.length - 1]}` : '', now = performance.now();
  if (runwayMemo && runwayMemo.key === key && now - runwayMemo.at < 200) return runwayMemo.v;
  const v = planRunway(line, {
    tile: (x, y) => world.getTile(x, y),
    aux: (x, y) => world.auxAt(x, y),
    sub: (x, y) => world.subAt(x, y),
    land: (x, y) => { const p = world.parcelAt(x, y); return p ? (world.mayEdit(p.owner) ? null : 'Not your land') : 'Buy this land first'; },
  });
  runwayMemo = { key, at: now, v };
  return v;
}

function updateStatus() {
  const h = input.hover;
  if (!h) { ui.setStatus(''); return; }
  const [x, y] = h;
  const t = world.getTile(x, y);
  let s = `(${x}, ${y})`;
  if (t !== undefined) {
    const terr = terrainOf(t);
    const k = world.kindIdAt(x, y), l = levelOf(t);
    if (isRoad(t)) { const v = world.trafficAt(x, y); s += ` · road${v > 10 ? ` · traffic ${Math.round((100 * v) / 255)}%` : ''}`; }
    else if (k) s += ` · ${KIND_NAMES[k]}${l ? (isCivicId(k) || stopModeOf(k) ? '' : ` L${l}`) : ' (empty lot)'}${underConstruction(t) ? ' · under construction' : ''}`;
    else s += ' · ' + (terr === Terrain.Water ? 'water' : terr === Terrain.Sand ? 'sand' : 'grass');
    const p = world.parcelAt(x, y);
    s += p ? ` · ${p.name} (${world.players.get(p.owner)?.name ?? p.owner}, tax ${Math.round(p.taxRate * 100)}%)` : ' · unclaimed land';
    const v = structureTool(input.tool) ? hoverArea(h).verdict : undefined;
    if (v) {
      const rot = input.rotationOf(input.tool), r = v.placed?.r;
      const facing = r === undefined ? '' : ` · door faces ${FRONT_NAMES[r]} (${rot === undefined ? 'auto' : 'chosen'}; Z/C turn)`;
      s += v.ok ? ` · click to place${facing}` : ` · ${v.reason}${facing}`;
    }
    if (input.tool === 'rail') s += rail.status(input.railPath);
    if (input.tool === 'road' && input.crossing) s += bridges.crossingStatus(input.crossing, DEV_TOOLS);
    else if (input.tool === 'road' && terr === Terrain.Water && !isRoad(t)) s += ' · drag a road straight across from a road on the bank to bridge the water';
    if (input.tool === 'roundabout' || input.tool === 'flyover') s += junctions.status(input.tool, x, y);
    if (input.tool === 'runway') {
      const rv = runwayVerdict(input.runwayLine ?? [h]);
      s += input.runwayLine
        ? (rv.ok ? ` · runway ${rv.s1! - rv.s0! + 1} tiles, $${rv.cost} · release to lay it` : ` · ${rv.reason}`)
        : ' · drag a straight line of 10+ tiles, 5 tiles behind an airport terminal';
    }
  }
  if (input.buyRect) {
    const r = input.buyRect, verdict = buyVerdict(r);
    s = `${r.w}×${r.h} tiles = $${(r.w * r.h * LAND_PRICE_PER_TILE).toLocaleString()}`;
    if (!verdict.ok) s += ` · ${verdict.reason}`;
    else if (world.myPlayer && world.myPlayer.money < r.w * r.h * LAND_PRICE_PER_TILE) s += ' · not enough money';
  }
  ui.setStatus(s);
}

// ---- tooltips: people and vehicles first, then buildings and roads, all answered live by the server ----
ui.nameOf = (x, y) => { const s = world.structureAt(x, y); return buildings.nameAt(s ? s.ax : x, s ? s.ay : y); }; // the name on its front (signs.ts)
let tipTimer = 0;
let tipRefresh = 0;
let tipTile: [number, number] | null = null;
let tipAgent = 0;
let mouse = { x: 0, y: 0 };
canvas.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; if (tipTile || tipAgent || tipTrain || tipPlane || tipHeli !== null) ui.moveTip(mouse.x, mouse.y); });
function hoverAt(tile: [number, number] | null) {
  if (ctxMenu.isOpen) return; // the right-click menu is up: no tooltips under it
  const id = tile && input.tool === 'select' && !input.buyRect ? citizens.pick(mouse.x, mouse.y, rig.camera, canvas.clientWidth, canvas.clientHeight) : 0;
  if (id) { hoverAgent(id); return; }
  if (tipAgent) { tipAgent = 0; ui.hideTip(); }
  // trains (render/trains.ts): picked from the vehicles drawn last frame, answered by the server (sim/rail.ts)
  const tr = tile && input.tool === 'select' && !input.buyRect ? trains.pick(mouse.x, mouse.y, rig.camera, canvas.clientWidth, canvas.clientHeight) : null;
  if (tr) { hoverTrain(tr); return; }
  if (tipTrain) { tipTrain = null; trains.hover = null; clearInterval(tipRefresh); ui.hideTip(); }
  // planes: the tooltip is worked out here from the flight (vehicles.ts)
  const pl = tile && input.tool === 'select' && !input.buyRect ? planes.pick(mouse.x, mouse.y, rig.camera, canvas.clientWidth, canvas.clientHeight) : null;
  if (pl) { hoverPlane(pl); return; }
  if (tipPlane) { tipPlane = null; planes.hover = null; ui.hideTip(); }
  // helicopters (render/helicopters.ts): worked out here from the flight, like planes
  const hl = tile && input.tool === 'select' && !input.buyRect ? helis.pick(mouse.x, mouse.y, rig.camera, canvas.clientWidth, canvas.clientHeight) : null;
  if (hl !== null) { hoverHeli(hl); return; }
  if (tipHeli !== null) { tipHeli = null; helis.hover = null; ui.hideTip(); }
  hoverTile(tile);
}
let tipHeli: number | null = null;
function hoverHeli(flight: number) {
  clearTimeout(tipTimer); clearInterval(tipRefresh);
  tipTile = null; tipAgent = 0; tipTrain = null; trains.hover = null; tipPlane = null; planes.hover = null; tipHeli = flight;
  helis.hover = flight;
  const s = helis.stateOf(flight);
  if (!s) { ui.hideTip(); return; }
  ui.showHtmlTip(heliTipHtml(s));
  ui.moveTip(mouse.x, mouse.y);
}
let tipTrain: { line: number; train: number } | null = null;
let tipPlane: { airport: number; flight: number } | null = null;
function hoverPlane(pl: { airport: number; flight: number }) {
  clearTimeout(tipTimer); clearInterval(tipRefresh);
  tipTile = null; tipAgent = 0; tipTrain = null; trains.hover = null; tipPlane = pl; tipHeli = null; helis.hover = null;
  planes.hover = `${pl.airport}:${pl.flight}`;
  const hit = planes.stateOf(pl.airport, pl.flight);
  if (!hit) { ui.hideTip(); return; }
  ui.showHtmlTip(planeTipHtml(hit.s, manifestOf(pl.airport, hit.s.flight)));
  ui.moveTip(mouse.x, mouse.y);
}
function hoverTrain(tr: { line: number; train: number }) {
  if (tipTrain && tipTrain.line === tr.line && tipTrain.train === tr.train) return;
  clearTimeout(tipTimer); clearInterval(tipRefresh);
  tipTile = null; tipAgent = 0; tipTrain = tr; tipPlane = null; planes.hover = null; tipHeli = null; helis.hover = null;
  trains.hover = tr;
  ui.hideTip();
  tipTimer = window.setTimeout(() => net.send({ t: 'inspectTrain', line: tr.line, train: tr.train }), 80);
  tipRefresh = window.setInterval(() => { if (tipTrain) net.send({ t: 'inspectTrain', line: tipTrain.line, train: tipTrain.train }); }, 1000);
}
net.on('train', (m) => {
  const v = selectedVehicle;
  if (v?.kind === 'train' && m.line === v.line && m.train === v.train) {
    if (!m.info) { selectVehicle(null); ui.toast('info', 'That train has gone out of service'); }
    else if (m.info.riders || m.info.consignments) { trainInfo = m.info; showTrainPanel(); } // a full answer (a hover's lacks the roster)
  }
  if (!tipTrain || m.line !== tipTrain.line || m.train !== tipTrain.train) return;
  if (!m.info) { ui.hideTip(); return; }
  ui.showHtmlTip(trainHtml(m.info, trains.consistOf(m.line, m.train)));
  ui.moveTip(mouse.x, mouse.y);
});
function hoverAgent(id: number) {
  if (tipTrain || tipPlane || tipHeli !== null) { tipTrain = null; tipPlane = null; tipHeli = null; trains.hover = null; planes.hover = null; helis.hover = null; }
  if (id === tipAgent) return;
  clearTimeout(tipTimer); clearInterval(tipRefresh);
  tipTile = null; tipAgent = id;
  ui.hideTip();
  tipTimer = window.setTimeout(() => net.send({ t: 'inspectCitizen', id }), 80);
  tipRefresh = window.setInterval(() => { if (tipAgent) net.send({ t: 'inspectCitizen', id: tipAgent }); }, 1000);
}
function hoverTile(tile: [number, number] | null) {
  if (tile) tile = world.doorOf(tile[0], tile[1]); // every tile of a structure shows the structure
  if (tile && !input.buyRect && input.tool === 'select' && isAirfieldAux(world.auxAt(tile[0], tile[1]))) {
    // runway and taxiway tiles: answered here from the loaded tiles, the same derivation the server runs
    clearTimeout(tipTimer); clearInterval(tipRefresh);
    tipTile = tile;
    const p = world.parcelAt(tile[0], tile[1]);
    ui.showRunwayTip(airfield.linkAt(tile[0], tile[1], world), p ? `${p.name} · ${world.players.get(p.owner)?.name ?? p.owner}` : 'unclaimed land');
    ui.moveTip(mouse.x, mouse.y);
    return;
  }
  if (tile && !input.buyRect && input.tool === 'select' && isRailAux(world.auxAt(tile[0], tile[1]))) {
    // railway track: answered here from the loaded tiles and the lines the server sent
    clearTimeout(tipTimer); clearInterval(tipRefresh);
    tipTile = tile;
    const p = world.parcelAt(tile[0], tile[1]);
    const html = rail.tileTip(tile[0], tile[1], p ? `${p.name} · ${world.players.get(p.owner)?.name ?? p.owner}` : 'unclaimed land');
    if (html) { ui.showHtmlTip(html); ui.moveTip(mouse.x, mouse.y); }
    return;
  }
  const t = tile ? world.getTile(tile[0], tile[1]) : undefined;
  const interesting = t !== undefined && (zoneOf(t) !== 0 || isRoad(t));
  if (!tile || !interesting || input.buyRect) { clearTimeout(tipTimer); clearInterval(tipRefresh); tipTile = null; ui.hideTip(); return; }
  if (tipTile && tipTile[0] === tile[0] && tipTile[1] === tile[1]) return;
  clearTimeout(tipTimer); clearInterval(tipRefresh);
  tipTile = tile;
  ui.hideTip();
  tipTimer = window.setTimeout(() => net.send({ t: 'inspect', x: tile[0], y: tile[1] }), 120);
  tipRefresh = window.setInterval(() => { if (tipTile) net.send({ t: 'inspect', x: tipTile[0], y: tipTile[1] }); }, 1500);
}
// agents move under a still cursor, so re-check the pick a few times a second
setInterval(() => { if (input.hover && !input.buyRect && !input.painting) hoverAt(input.hover); }, 250);
net.on('building', (m) => {
  if (m.info?.people && selectedBuilding && m.x === selectedBuilding[0] && m.y === selectedBuilding[1]) ui.showBuilding(m.info, selectedCitizen);
  else if (!m.info && selectedBuilding && m.x === selectedBuilding[0] && m.y === selectedBuilding[1]) closeBuilding();
  if (tipAgent || !tipTile || m.x !== tipTile[0] || m.y !== tipTile[1]) return;
  if (!m.info) { ui.hideTip(); return; }
  ui.showTip(m.info);
  ui.moveTip(mouse.x, mouse.y);
});
net.on('road', (m) => {
  if (tipAgent || !tipTile || m.x !== tipTile[0] || m.y !== tipTile[1]) return;
  if (!m.info) { ui.hideTip(); return; }
  ui.showRoadTip(m.info);
  ui.moveTip(mouse.x, mouse.y);
});

// ---- frame loop --------------------------------------------------------------------------------
const getTile = (x: number, y: number) => world.getTile(x, y);
const auxAt = (x: number, y: number) => world.auxAt(x, y);
let last = performance.now();
let vehTick = 0, vehAt = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  perf.frame(now);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  tour?.frame(dt); // the tour's camera flight, before the rig places the camera
  rig.update();
  adaptQuality(dt);

  lighting.update(liveHour(), rig.target, rig.dist);
  scene.background = lighting.sky;
  const fog = scene.fog as Fog;
  fog.color.copy(lighting.sky);
  // fog thickens with zoom-out, but never reaches past the loaded chunks when looking toward the horizon
  fog.far = fogFar();
  fog.near = Math.min(rig.dist * 1.6 + 30, fog.far * 0.45);

  let budget = 4;
  for (const [key, v] of views) {
    const c = world.chunks.get(key);
    if (c?.dirty && budget-- > 0) { v.rebuild(c, key, getTile, buildings, auxAt); lights.scanChunk(key, c, getTile); parks.scanChunk(key, c, getTile); airfield.scanChunk(key, c, world); helis.scanChunk(key, c, world); trains.scanChunk(key, c); junctions.scanChunk(key, c); bridges.scanChunk(key, c); landmarks.scanChunk(key, c, getTile); c.dirty = false; }
  }
  if (airfield.update(world)) planes.setAirports(airfield.airports());
  if (world.parcelsDirty) { parcelsView.rebuild(world.parcels.values(), world.players, world.me, selectedParcel); world.parcelsDirty = false; }
  applyTrafficUpdates();
  citizens.frame(now, dt);
  lines.frame();
  if (routeView.active) routeView.frame(citizens.positionOf(selectedCitizen), now);
  lights.frame(liveTick(), signalled);
  // trains and planes run on a tick that follows the server's but never steps back or jumps when a stats message lands,
  // so a cab view along the track stays perfectly smooth
  const live = liveTickF(), rdt = ((now - vehAt) / TICK_MS) * clock.rate;
  vehAt = now;
  vehTick = Math.abs(live - vehTick) > 4 ? live : vehTick + rdt + (live - vehTick) * Math.min(1, dt * 1.5);
  planes.frame(vehTick);
  helis.frame(vehTick);
  trains.frame(vehTick);
  rail.frame(input.tool === 'rail' ? input.railPath : null);
  airfield.frame();
  parks.frame(clock.day);
  landmarks.frame((vehTick * 24) / TICKS_PER_DAY);
  bridges.frame(landmarks.fixedHours ?? (vehTick * 24) / TICKS_PER_DAY); // Tower Bridge's gates, on the lift schedule the leaves keep
  fpv.update(now, dt, routeInfo?.id === selectedCitizen ? routeInfo.route ?? null : null);
  if ((following || fpv.mode === 'full') && selectedCitizen) {
    const pos = citizens.positionOf(selectedCitizen);
    if (pos) { rig.target.x += (pos[0] - rig.target.x) * Math.min(1, dt * 6); rig.target.z += (pos[1] - rig.target.z) * Math.min(1, dt * 6); }
  }
  if ((following || fpv.mode === 'full') && selectedVehicle) {
    const pos = vehiclePos();
    if (pos) { rig.target.x += (pos[0] - rig.target.x) * Math.min(1, dt * 6); rig.target.z += (pos[1] - rig.target.z) * Math.min(1, dt * 6); }
  }

  const h = input.hover;
  hoverMesh.visible = !!h && !input.buyRect;
  if (h) {
    const area = hoverArea(h);
    hoverMesh.scale.set(area.w, 1, area.h);
    hoverMesh.position.set(area.x + area.w / 2, 0.04, area.y + area.h / 2);
    const hm = hoverMesh.material as MeshBasicMaterial;
    hm.color.setHex(area.verdict ? (area.verdict.ok ? 0x62d2a2 : 0xff3b30) : 0xffffff);
    hm.opacity = area.verdict ? (area.verdict.ok ? 0.45 : 0.6) : 0.22; // a refusal must read as red over grass
    // outline, door arrow and marks: full strength for a footprint being placed, faint over a structure that stands
    if (area.placed && !input.buyRect) {
      const p = area.placed, ahead = world.getTile(p.frontX, p.frontY);
      footprint.show(p, { ok: area.existing ? null : area.verdict?.ok ?? false, road: ahead !== undefined && isRoad(ahead), faint: !!area.existing, hover: h });
    } else footprint.hide();
  } else footprint.hide();
  footprint.frame(rig.camera, canvas.clientWidth, canvas.clientHeight);
  const r = input.buyRect;
  rectMesh.visible = !!r;
  if (r) {
    rectMesh.scale.set(r.w, 1, r.h);
    rectMesh.position.set(r.x + r.w / 2, 0.05, r.y + r.h / 2);
    const me = world.myPlayer;
    const okBuy = !!me && me.money >= r.w * r.h * LAND_PRICE_PER_TILE && buyVerdict(r).ok;
    const rm = rectMesh.material as MeshBasicMaterial;
    rm.color.setHex(okBuy ? 0x62d2a2 : 0xff3b30);
    rm.opacity = okBuy ? 0.35 : 0.6; // a refused rectangle must read as red, not brown, over grass
    updateStatus();
  }
  buildings.updateLod(fpv.mode === 'off' ? [rig.camera] : [rig.camera, fpv.camera], lighting.sun); // detail tiers and culling (render/buildings.ts)
  fpv.render(renderer, scene, rig.camera, [hoverMesh, rectMesh, footprint.group, routeView.group, parcelsView.group]);
}
requestAnimationFrame(frame);

// debugging hook: inspect client state from the devtools console
(window as any).msc = { world, rig, input, net, views, lighting, buildings, landmarks, bridges, citizens, lights, liveTick, liveTickF, planes, helis, airfield, trains, rail, renderer, scene, streamChunks, streamWindow, subscribed, ui, selectCitizen, selectVehicle, vehicle: () => selectedVehicle, setHeat, routeView, routeInfo: () => routeInfo, fpv, state: () => ({ selectedParcel, panelShown, selectedCitizen, following, subscribed: subscribed.size }) };
void localIndex;

// ---- boot -------------------------------------------------------------------------------------------
ui.setConn(false);
// a local game that just replaced itself (load, import, new game) reloads straight back in; otherwise ?name= or the join form
const rejoin = local && (() => { try { const r = sessionStorage.getItem(AUTOJOIN); sessionStorage.removeItem(AUTOJOIN); return r ? localStorage.getItem('msimcity.name') : null; } catch { return null; } })();
const autoName = params.get('name') || rejoin;
// test cities (worlds.ts): `?ws=host:port&city=n` connects to one, `?city=n` alone starts it first; the perf readout (M, or the top-bar chip) is always on there
const cityParam = testCityOf(params);
const viaWs = !!params.get('ws');
const hud = document.getElementById('worldHud')!;
const perf = new PerfHud({ net, renderer, agentsDrawn: () => citizens.count, chunksLoaded: () => views.size }, hud, document.getElementById('perfBtn'), { forceOn: cityParam > 0 });
Object.assign((window as any).msc, { perf, lines });
const localUi = local ? mountLocalUi(local, (kind, msg) => ui.toast(kind, msg), () => world.myPlayer?.name ?? localStorage.getItem('msimcity.name') ?? 'Mayor') : null;
if (local) {
  (window as any).msc.local = local;
  void local.pause(true); // the city waits behind the join form
  document.querySelector('#help a')?.setAttribute('href', 'viewer.html'); // relative: the static build can live under any path
  if (__LOCAL_ONLY__) registerServiceWorker((kind, msg) => ui.toast(kind, msg));
}
if (cityParam) { showCityBanner(cityParam, params, hud); reviveCity(cityParam, net); }
if (demoParam) {
  showDemoBanner(demoParam, params, hud);
  reviveDemo(demoParam, net);
  tour = new TourPanel({
    demo: demoParam, net, rig, scene, buildingHtml: (info) => ui.buildingHtml(info, 'h3'),
    chipMount: document.getElementById('techBtn')!, onFly: () => { following = false; },
  });
  (window as any).msc.tour = tour;
}
async function connect(name: string) {
  if (local) { net.connect(name); void local.pause(false); return; }
  if (demoParam && !viaWs && !(await startDemo(demoParam))) { ui.toast('error', 'The demo did not start'); return; }
  if (cityParam && !viaWs) { // ?city=n alone: bring the city up, then point the socket at it
    ui.toast('info', `Starting test city ${cityParam}×${cityParam}…`);
    if (!(await startCity(cityParam))) { ui.toast('error', 'The test city did not start'); return; }
    net.url = `ws://${cityWsHost(cityParam)}`;
  }
  net.connect(name);
}
if (autoName) void connect(autoName);
else {
  const picker = viaWs || demoParam || local ? null : new WorldPicker(document.getElementById('worlds')!, cityParam || remembered());
  const form = document.getElementById('loginForm')!;
  if (local && localUi) void localLogin(local, form, localUi.dialog, !__LOCAL_ONLY__);
  else if (!viaWs && !demoParam && !cityParam) addPlayOffline(form);
  ui.login().then((name) => {
    if (picker?.selected) void picker.join(name, document.querySelector<HTMLButtonElement>('#loginForm button[type=submit]')!);
    else if (picker) net.connect(name); // the live world, whatever ?city= said
    else void connect(name);
  });
}
