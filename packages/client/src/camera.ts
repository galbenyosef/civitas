import { PerspectiveCamera, Vector3, Plane, Raycaster, Vector2 } from 'three';

const PITCH_MIN = 0.18, PITCH_MAX = 1.5, DIST_MIN = 6, DIST_MAX = 220;

/** Orbit-style rig looking at a point on the ground plane; pan/zoom/rotate. */
export class CameraRig {
  camera: PerspectiveCamera;
  target = new Vector3(0, 0, 0);
  yaw = Math.PI / 4;
  pitch = 0.95;
  dist = 48;
  private plane = new Plane(new Vector3(0, 1, 0), 0);
  private ray = new Raycaster();
  private ndc = new Vector2();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(50, aspect, 0.5, 2000);
    this.update();
  }
  update() {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.dist * Math.sin(this.yaw) * cp,
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z + this.dist * Math.cos(this.yaw) * cp,
    );
    this.camera.lookAt(this.target);
  }
  /** horizontal forward and right vectors in world space */
  forward() { return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  /** world units per screen pixel at the target depth */
  worldPerPixel(viewportHeight: number) {
    return (2 * this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportHeight;
  }
  panPixels(dx: number, dy: number, viewportHeight: number) {
    const s = this.worldPerPixel(viewportHeight);
    this.target.addScaledVector(this.right(), -dx * s);
    this.target.addScaledVector(this.forward(), dy * s);
  }
  zoom(factor: number) { this.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, this.dist * factor)); }
  /** Zoom keeping the ground point under a screen position where it is (the cursor); plain zoom over the sky. */
  zoomAt(factor: number, px: number, py: number, w: number, h: number) {
    this.update(); this.camera.updateMatrixWorld();
    const before = this.groundAt(px, py, w, h, new Vector3());
    this.zoom(factor);
    if (!before) return;
    this.update(); this.camera.updateMatrixWorld();
    const after = this.groundAt(px, py, w, h, new Vector3());
    if (after) { this.target.x += before.x - after.x; this.target.z += before.z - after.z; }
  }
  rotate(dYaw: number, dPitch = 0) {
    this.yaw += dYaw;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dPitch));
  }
  /** Orbit around a ground point (e.g. the tile under the cursor) instead of the view centre. */
  orbitAround(pivot: Vector3, dYaw: number, dPitch = 0) {
    const ox = this.target.x - pivot.x, oz = this.target.z - pivot.z;
    const c = Math.cos(dYaw), s = Math.sin(dYaw);
    this.target.x = pivot.x + ox * c + oz * s;
    this.target.z = pivot.z - ox * s + oz * c;
    this.rotate(dYaw, dPitch);
  }
  /** Ground-plane hit for a screen position; returns null when looking at the sky. */
  groundAt(px: number, py: number, w: number, h: number, out = new Vector3()): Vector3 | null {
    this.ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out);
  }
  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /** Put the camera on a shot (CameraShot); the parts it leaves out stay as they are. */
  setShot(s: CameraShot) {
    if (s.x !== undefined && s.y !== undefined) this.target.set(s.x, 0, s.y);
    if (s.dist !== undefined) this.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, s.dist));
    if (s.yaw !== undefined) this.yaw = (s.yaw * Math.PI) / 180;
    if (s.pitch !== undefined) this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, (s.pitch * Math.PI) / 180));
    this.update();
  }
  /** This view as a shot string, "x,y,dist,yaw,pitch" (degrees), plus ",hour" when one is given: what DEFAULT_VIEW takes. */
  shotString(hour?: number) {
    const r = (v: number, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d);
    const yaw = ((((this.yaw * 180) / Math.PI) % 360) + 360) % 360;
    return [r(this.target.x), r(this.target.z), r(this.dist), r(yaw), r((this.pitch * 180) / Math.PI), ...(hour !== undefined ? [r(hour, 2)] : [])].join(',');
  }
}

/**
 * A camera shot: the ground point looked at (tile x, y), the distance, the orbit angle and the tilt in degrees (yaw 0 looks
 * north from the south, 90 looks west from the east; pitch 90 is straight down) and, optionally, a frozen hour of the day.
 * From the URL (`?at=x,y&dist=n&yaw=deg&pitch=deg&hour=h`) or from the server's DEFAULT_VIEW ("x,y,dist,yaw,pitch[,hour]").
 */
export interface CameraShot { x?: number; y?: number; dist?: number; yaw?: number; pitch?: number; hour?: number }
/** "x,y,dist,yaw,pitch[,hour]" as a shot; null when it is not five or six numbers */
export function parseShot(s: string | undefined): CameraShot | null {
  const v = (s ?? '').split(',').map((p) => Number(p.trim()));
  if ((v.length !== 5 && v.length !== 6) || !v.every(Number.isFinite)) return null;
  return { x: v[0], y: v[1], dist: v[2], yaw: v[3], pitch: v[4], ...(v.length === 6 ? { hour: v[5] } : {}) };
}
/** the URL's camera parameters as a shot, or null when it has none */
export function urlShot(params: URLSearchParams): CameraShot | null {
  const at = params.get('at')?.split(',').map(Number), num = (k: string) => (params.get(k) !== null && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : undefined);
  const s: CameraShot = { ...(at && at.length === 2 && at.every(Number.isFinite) ? { x: at[0], y: at[1] } : {}), dist: num('dist'), yaw: num('yaw'), pitch: num('pitch') };
  return s.x !== undefined || s.dist !== undefined || s.yaw !== undefined || s.pitch !== undefined ? s : null;
}
