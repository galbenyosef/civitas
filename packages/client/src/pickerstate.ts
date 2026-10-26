/**
 * The size picker's two bits of state that decide what is on screen (picker.ts), kept apart from the DOM so a check can
 * run them: what the "about" box shows while the mouse is over the cards, and whether a refresh has anything to redraw.
 *
 * The picker used to rebuild its whole popover on every refresh, and a refresh came with every players message (the money
 * ticks) through ui.setLocks. A rebuild put the about box back to the active tool's text and made a new element under the
 * mouse, which fired its hover again: with the mouse over a card the box flicked between the active size and the one
 * hovered, once per message. Now a refresh redraws only when what the cards show has changed, and a hovered card's text
 * stays until the mouse leaves the cards.
 */

/** What the cards show: the ladder, the active rung and which rungs are locked. A refresh with the same key changes nothing. */
export function pickerKey(group: string, active: string, locked: readonly boolean[], thumbs: number): string {
  return `${group}|${active}|${locked.map((l) => (l ? 1 : 0)).join('')}|${thumbs}`;
}

/** The rung the about box describes: the hovered card's, else the active tool's. */
export class AboutState {
  /** the tool id of the card under the mouse, or null when the mouse is not over the cards */
  hovered: string | null = null;
  enter(tool: string) { this.hovered = tool; }
  leave() { this.hovered = null; }
  /** the tool id the box describes */
  shown(active: string): string { return this.hovered ?? active; }
}
