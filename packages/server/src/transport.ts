/**
 * The transport seam (docs/local-mode.md section 2). `Net` talks to clients through `Conn`s handed to it by a
 * `ConnSource`, so the same game runs over WebSockets on the server (transport-ws.ts, `WsSource`) and over a
 * `MessagePort` in a browser worker (`PortSource`, below). Frames are JSON strings either way, exactly as on the wire.
 * This module is pure: no Node APIs, nothing from `ws`.
 */

/** One connected client, whatever carries it. */
export interface Conn {
  readonly open: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(fn: (data: string) => void): void;
  /** also fires on error; at most once */
  onClose(fn: () => void): void;
}

/** Where connections come from. Net subscribes once. */
export interface ConnSource { onConnection(fn: (c: Conn) => void): void }

/** What PortSource needs of a MessagePort or a worker's global scope (both have these). */
export interface PortLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void;
  start?(): void;
}
type Transferable = unknown;
interface MessageEvent { data: unknown; ports?: readonly unknown[] }

/**
 * Control envelope, kept apart from the game protocol: game frames are strings, control messages are `{ ctl }` objects.
 * Client to host: `connect` (optionally carrying a port in `ports[0]` for its own connection), `close`.
 * Host to client: `ready` (the connection is open; send `hello`), `close`.
 * Anything else (save, load, pause, ... in a later phase) goes to `PortSource.onControl`.
 */
export type Control = { ctl: string; [k: string]: unknown };
export const isControl = (d: unknown): d is Control => typeof d === 'object' && d !== null && typeof (d as Control).ctl === 'string';

/** A Conn over one port: strings are frames, `{ctl:'close'}` from the other side closes it. */
class PortConn implements Conn {
  open = true;
  private msg: ((data: string) => void)[] = [];
  private closed: (() => void)[] = [];
  constructor(private port: PortLike) {}
  send(data: string) { if (this.open) this.port.postMessage(data); }
  close(code?: number, reason?: string) {
    if (!this.open) return;
    try { this.port.postMessage({ ctl: 'close', code, reason }); } catch { /* the other side is gone */ }
    this.ended();
  }
  onMessage(fn: (data: string) => void) { this.msg.push(fn); }
  onClose(fn: () => void) { this.closed.push(fn); }
  /** from PortSource: a frame or a close from the client */
  receive(d: string) { if (this.open) for (const fn of this.msg) fn(d); }
  ended() {
    if (!this.open) return;
    this.open = false;
    for (const fn of this.closed) fn();
  }
}

/**
 * Connections over MessagePorts (local mode: the client's main thread and the game in a worker). The endpoint is a
 * MessagePort or the worker's global scope. Each `{ctl:'connect'}` posted to it opens a connection: on the port it carries
 * (`ports[0]`, so several tabs can share one game later), or on the endpoint itself, replacing the endpoint's previous
 * connection (a reconnect). The host answers `{ctl:'ready'}` on that port once Net has the connection.
 */
export class PortSource implements ConnSource {
  private fn: ((c: Conn) => void) | null = null;
  /** the connection on the endpoint itself, if any */
  private main: PortConn | null = null;
  /** control messages that are not connect/close (save, load, pause, ...): for the worker host */
  onControl: (m: Control, reply: (m: unknown) => void) => void = () => {};

  constructor(private endpoint: PortLike) {
    endpoint.addEventListener('message', (ev) => {
      const port = ev.ports?.[0] as PortLike | undefined;
      if (isControl(ev.data) && ev.data.ctl === 'connect') { if (port) this.attach(port); else this.main = this.connect(endpoint, this.main); return; }
      this.dispatch(this.main, ev.data, endpoint);
    });
    endpoint.start?.();
  }

  onConnection(fn: (c: Conn) => void) { this.fn = fn; }

  /** a client's own port: its frames and closes arrive there */
  private attach(port: PortLike) {
    let conn: PortConn | null = null;
    port.addEventListener('message', (ev) => {
      if (isControl(ev.data) && ev.data.ctl === 'connect') { conn = this.connect(port, conn); return; }
      this.dispatch(conn, ev.data, port);
    });
    port.start?.();
    conn = this.connect(port, null);
  }

  private connect(port: PortLike, prev: PortConn | null): PortConn {
    prev?.ended();
    const c = new PortConn(port);
    port.postMessage({ ctl: 'ready' });
    this.fn?.(c);
    return c;
  }

  private dispatch(conn: PortConn | null, d: unknown, port: PortLike) {
    if (typeof d === 'string') { conn?.receive(d); return; }
    if (!isControl(d)) return;
    if (d.ctl === 'close') { conn?.ended(); return; }
    this.onControl(d, (m) => port.postMessage(m));
  }
}
