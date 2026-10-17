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
}
