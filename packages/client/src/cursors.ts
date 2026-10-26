import type { ToolId } from './input';

/**
 * The canvas cursor follows the active tool (style.css, `canvas.cur-*`): a bulldozer for bulldoze, a road mark for the tools
 * that drag a road, track or line over the ground, a crosshair for the rest that place something, and over a pickable
 * building, person or vehicle in select mode a pointing hand. It is a class on the canvas, set when the tool changes and
 * when the hover crosses onto or off something pickable, so nothing runs per frame. Pan and orbit still set the cursor
 * inline (input.ts), which wins over the class while they last. It changes what the mouse looks like, never what a click does.
 */
export type ToolCursor = 'cur-select' | 'cur-bulldoze' | 'cur-road' | 'cur-build';
const ROAD_LIKE = new Set<string>(['road', 'rail', 'pylons', 'cable', 'runway', 'streetrule']);
export function toolCursor(tool: ToolId | string): ToolCursor {
  if (tool === 'select') return 'cur-select';
  if (tool === 'bulldoze') return 'cur-bulldoze';
  return ROAD_LIKE.has(tool) ? 'cur-road' : 'cur-build';
}

/** What `classList` gives us, so a check can pass a fake */
export interface ClassListLike { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, on?: boolean): boolean }
const ALL: ToolCursor[] = ['cur-select', 'cur-bulldoze', 'cur-road', 'cur-build'];
/** Put the tool's cursor class on the canvas (and take the old one and the pointing hand off) */
export function applyToolCursor(cl: ClassListLike, tool: ToolId | string) {
  cl.remove(...ALL, 'cur-pick');
  cl.add(toolCursor(tool));
}
/** The pointing hand over something pickable: only in select mode, where a click opens it */
export function applyPickHint(cl: ClassListLike, tool: ToolId | string, over: boolean) {
  cl.toggle('cur-pick', over && tool === 'select');
}
