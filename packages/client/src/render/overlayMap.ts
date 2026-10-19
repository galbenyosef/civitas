import { CHUNK_SIZE, parseKey } from '@msimcity/shared';
import { overlayTexture, OVL_SIZE } from './materials';

/**
 * The data overlay's map on the GPU (render/materials.ts overlayTexture, read by the ground and building shaders): each
 * loaded chunk's bytes copied into its 32×32 block of a wrapped OVL_SIZE² texture. Uploaded at most once a frame.
 */
export class OverlayMap {
  private data = overlayTexture.image.data as Uint8Array;

  /** Copy the chunks that changed (ClientWorld.overlayDirty) into the texture; absent chunks are cleared. */
  update(dirty: Set<string>, bytesOf: (key: string) => Uint8Array | undefined) {
    if (!dirty.size) return;
    for (const key of dirty) {
      const [cx, cy] = parseKey(key);
      const tx = ((cx * CHUNK_SIZE) % OVL_SIZE + OVL_SIZE) % OVL_SIZE, ty = ((cy * CHUNK_SIZE) % OVL_SIZE + OVL_SIZE) % OVL_SIZE;
      const b = bytesOf(key);
      for (let y = 0; y < CHUNK_SIZE; y++) {
        const row = (ty + y) * OVL_SIZE + tx;
        if (b) this.data.set(b.subarray(y * CHUNK_SIZE, (y + 1) * CHUNK_SIZE), row);
        else this.data.fill(0, row, row + CHUNK_SIZE);
      }
    }
    dirty.clear();
    overlayTexture.needsUpdate = true;
  }

  clear() { this.data.fill(0); overlayTexture.needsUpdate = true; }
}
