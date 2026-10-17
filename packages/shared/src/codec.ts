function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const u16ToB64 = (a: Uint16Array) => bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
export const b64ToU16 = (s: string) => new Uint16Array(b64ToBytes(s).buffer);
export const i32ToB64 = (a: Int32Array) => bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
export const b64ToI32 = (s: string) => new Int32Array(b64ToBytes(s).buffer);
export const u8ToB64 = (a: Uint8Array) => bytesToB64(a);
export const b64ToU8 = (s: string) => b64ToBytes(s);
