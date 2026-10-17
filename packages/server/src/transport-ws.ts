import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Conn, ConnSource } from './transport';

/** The server's transport (transport.ts): one Conn per WebSocket on the http server's port. Node only. */
export class WsSource implements ConnSource {
  private wss: WebSocketServer;
  constructor(http: HttpServer) { this.wss = new WebSocketServer({ server: http }); }
  onConnection(fn: (c: Conn) => void) {
    this.wss.on('connection', (ws) => fn(wsConn(ws)));
  }
}

function wsConn(ws: WebSocket): Conn {
  return {
    get open() { return ws.readyState === WebSocket.OPEN; },
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onMessage: (fn) => { ws.on('message', (data) => fn(data.toString())); },
    onClose: (fn) => { let done = false; const once = () => { if (!done) { done = true; fn(); } }; ws.on('close', once); ws.on('error', once); },
  };
}
