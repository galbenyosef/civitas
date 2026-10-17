import { MANIFEST } from './buildings/compiled';

/**
 * Gateways: the buildings newcomers arrive through and leavers go out by (the server's sim/gateways.ts). Which kinds
 * are gateways, and how, is catalogue data: the `gateway`, `gatewayModes` and `arrivalsPerHour` attributes
 * (docs/buildings.md). A motorway connection brings people in by car, a rail station or halt, a bus depot (intercity
 * coaches) and an airport terminal bring them in on foot with a suitcase or by taxi. A seaport (`gateway: 'sea'`,
 * `needsWater`) slots in as one more kind once it exists.
 */
export type GatewayType = 'motorway' | 'rail' | 'bus' | 'air' | 'sea';
export type GatewayMode = 'car' | 'foot' | 'taxi';
export interface GatewaySpec { kind: number; type: GatewayType; modes: GatewayMode[]; perHour: number; needsWater: boolean }

const TYPES: readonly string[] = ['motorway', 'rail', 'bus', 'air', 'sea'];
const MODES: readonly string[] = ['car', 'foot', 'taxi'];
/** by kind id; undefined for kinds that are not gateways */
export const GATEWAY_OF: (GatewaySpec | undefined)[] = [];
for (const k of MANIFEST) {
  const a = { ...k.attrs, ...(k.levels[0]?.attrs ?? {}) } as Record<string, unknown>;
  if (typeof a.gateway !== 'string' || !TYPES.includes(a.gateway)) continue;
  const modes = (Array.isArray(a.gatewayModes) ? a.gatewayModes : ['foot']).filter((m): m is GatewayMode => typeof m === 'string' && MODES.includes(m));
  GATEWAY_OF[k.kindId] = {
    kind: k.kindId, type: a.gateway as GatewayType, modes: modes.length ? modes : ['foot'],
    perHour: typeof a.arrivalsPerHour === 'number' ? Math.max(0, a.arrivalsPerHour) : 0, needsWater: a.needsWater === true,
  };
}
export const isGatewayId = (kind: number) => GATEWAY_OF[kind] !== undefined;
/** The motorway connection's kind id (through-traffic and inter-city freight use only motorway gateways). */
export const MOTORWAY_KIND = MANIFEST.find((k) => k.id === 'motorway')?.kindId ?? -1;
export const GATEWAY_WORDS: Record<GatewayType, string> = { motorway: 'the motorway', rail: 'the station', bus: 'the coach station', air: 'the airport', sea: 'the harbour' };

/** A gateway's panel figures (BuildingInfo.gateway). */
export interface GatewayInfo {
  type: GatewayType; modes: GatewayMode[]; perHour: number;
  arrivalsToday: number; departuresToday: number; arrivalsYesterday: number; departuresYesterday: number;
  /** newcomers queued for this gate (housing and job demand the gate cannot bring in yet) */
  waiting: number;
  /** on their way in from it or out to it right now */
  enRoute: number;
  /** taking arrivals: built, and staffed unless it is a motorway connection */
  open: boolean;
}
