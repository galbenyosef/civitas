import type { ClientMsg, ServerMsg } from '@msimcity/shared';

type Handler<T extends ServerMsg['t']> = (m: Extract<ServerMsg, { t: T }>) => void;

/**
 * One connection to a game, whatever carries it (docs/local-mode.md section 2): a WebSocket to a server, or a local-mode
 * worker's MessagePort. Frames are JSON strings either way.
 */
export interface ClientSocket {
  readonly open: boolean;
  /** reconnect after a drop (a server restarting); a worker never drops, so a closed WorkerSocket stays closed */
  readonly retry: boolean;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

/** A WebSocket to a Civitas server. */
export class WsSocket implements ClientSocket {
  readonly retry = true;
  private ws: WebSocket;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => this.onopen?.();
    ws.onmessage = (ev) => this.onmessage?.(ev.data);
    ws.onclose = () => this.onclose?.();
    ws.onerror = () => ws.close();
  }
  get open() { return this.ws.readyState === WebSocket.OPEN; }
  send(data: string) { this.ws.send(data); }
  close() { this.ws.close(); }
}

/**
 * A connection to the game in a local-mode worker (server/src/transport.ts PortSource): posts `{ctl:'connect'}` and is
 * open once the worker answers `{ctl:'ready'}`. Game frames are strings; other `{ctl}` objects are the worker host's.
 */
export class WorkerSocket implements ClientSocket {
  readonly retry = false;
  private isOpen = false;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  /** control messages from the worker host other than ready/close (saves, errors; a later phase) */
  oncontrol: ((m: { ctl: string; [k: string]: unknown }) => void) | null = null;
  constructor(private port: Worker | MessagePort) {
    port.addEventListener('message', this.listener as EventListener);
    if ('start' in port) port.start();
    port.postMessage({ ctl: 'connect' });
  }
  private listener = (ev: MessageEvent) => {
    const d = ev.data;
    if (typeof d === 'string') { if (this.isOpen) this.onmessage?.(d); return; }
    if (!d || typeof d.ctl !== 'string') return;
    if (d.ctl === 'ready') { if (!this.isOpen) { this.isOpen = true; this.onopen?.(); } }
    else if (d.ctl === 'close') this.ended();
    else this.oncontrol?.(d);
  };
  private ended() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.port.removeEventListener('message', this.listener as EventListener);
    this.onclose?.();
  }
  get open() { return this.isOpen; }
  send(data: string) { if (this.isOpen) this.port.postMessage(data); }
  close() { if (this.isOpen) { this.port.postMessage({ ctl: 'close' }); this.ended(); } }
}

/** Typed game connection with automatic reconnect (for sockets that retry). */
export class NetClient {
  private sock: ClientSocket | null = null;
  private handlers = new Map<string, (m: any) => void>();
  private name = '';
  private closedByUs = false;
  private factory: () => ClientSocket;
  private wsUrl = '';
  onStatus: (connected: boolean) => void = () => {};
  /** what this client has received, for the perf readout (render/perfhud.ts): characters of JSON (about bytes), messages, moving agents */
  rx = { bytes: 0, msgs: 0, agents: 0 };
  private taps: ((m: ServerMsg) => void)[] = [];

  /** a server's WebSocket URL, or a factory for any other transport (WorkerSocket in local mode) */
  constructor(to: string | (() => ClientSocket)) {
    if (typeof to === 'string') this.url = to; else this.factory = to;
    this.factory ??= () => new WsSocket(this.wsUrl);
  }
  /** the server's WebSocket URL; setting it switches to that server on the next connect */
  get url() { return this.wsUrl; }
  set url(u: string) { this.wsUrl = u; this.factory = () => new WsSocket(u); }

  /** Look at every incoming message without taking over its handler. */
  tap(fn: (m: ServerMsg) => void) { this.taps.push(fn); }

  connect(name: string) {
    this.name = name;
    this.closedByUs = false;
    this.open();
  }
  private open() {
    const sock = this.factory();
    this.sock = sock;
    sock.onopen = () => { this.onStatus(true); this.send({ t: 'hello', name: this.name }); };
    sock.onmessage = (data) => {
      const m = JSON.parse(data) as ServerMsg;
      this.rx.bytes += data.length; this.rx.msgs++;
      if (m.t === 'citizens') this.rx.agents += m.c.length >> 2; // quads of id, x, y, flags
      for (const fn of this.taps) fn(m);
      this.handlers.get(m.t)?.(m);
    };
    sock.onclose = () => {
      this.onStatus(false);
      if (!this.closedByUs && sock.retry) setTimeout(() => this.open(), 1500);
    };
  }
  send(m: ClientMsg) {
    if (this.sock?.open) this.sock.send(JSON.stringify(m));
  }
  on<T extends ServerMsg['t']>(t: T, fn: Handler<T>) { this.handlers.set(t, fn); }
  get connected() { return !!this.sock?.open; }
}
