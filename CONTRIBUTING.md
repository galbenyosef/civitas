# Contributing to Civitas

Thanks for helping. The easiest and most welcome contribution is a **building**: every model in the game is a short
TypeScript recipe of simple shapes, so you need no 3D tools, and a design reviews as plain text in a pull request.

## Add a building in about ten minutes

1. Fork and clone the repo, then `npm install` and `npm run dev`. The game runs on http://localhost:5173 and the building
   viewer on http://localhost:5173/viewer.html.
2. Read the [brief for AI designers](docs/buildings.md#brief-for-ai-designers) in `docs/buildings.md`. It is complete
   on its own: the coordinate space, usual heights per kind and level, every shape (`box`, `roof`, `cyl`, `cone`,
   `taper`, `lathe`, ...), the colour palette, windows and facades. You can paste it straight into a prompt for Claude or
   another model and ask for designs.
3. Add your design objects to a file in `packages/shared/src/buildings/designs/` (see `examples.ts` for three worked
   examples) with `draft: true` and an `author` field. Drafts appear in the viewer only, never in the city.
4. Look at it in the viewer: it hot-reloads on save and shows the model on a turntable by day and night. Use the
   Designer filter to find yours.
5. Check it:
   - `npm run buildings:check` (the whole catalogue)
   - `npx tsx packages/shared/scripts/check-drafts.ts packages/shared/src/buildings/designs/<your-file>.ts` (window
     collisions, parts outside the tile, floating parts)
6. Remove `draft: true` when you are happy, and open a pull request with a screenshot from the viewer.

Recognisable real buildings (landmarks) are welcome too: see the next section.

## Add a landmark in about an hour

A landmark is a famous building (the Gherkin, or just a Victorian town hall with a clock tower) drawn as a recipe of simple
shapes. It starts as a **draft** that shows in the viewer only, so it needs no tool, collection or tech node until a
maintainer accepts it. `docs/landmarks.md` is the whole brief and is complete on its own: paste it into a model's prompt
or read it yourself.

1. `npm install` and `npm run dev`; the viewer is http://localhost:5173/viewer.html.
2. Read `docs/landmarks.md` (scale: 33 m a tile; footprints up to 4×4; every op; windows and facades; the palette; moving
   parts; the review rubric). Look at the two worked examples in `packages/shared/src/buildings/landmark-drafts.ts`: a town
   hall clock tower (2×2, with dials that light at dusk and show the time) and a war memorial (1×1, 20 ops).
3. In the same file copy `TEMPLATE`, give it the next free kind id in **230-249**, the tags `['draft', '<city or era>']`,
   your `author`, a `blurb` and `howTo` in the game's voice, and draw it. Add it to `LANDMARK_DRAFTS`.
4. Look at it at http://localhost:5173/viewer.html?tag=draft (the Tag row, by day and night, and far away with the zoom).
5. Check it: `npm run landmarks:check` (every landmark) or `npx tsx packages/shared/scripts/check-landmarks.ts <file.ts>`
   for a scratch file, then `npm run buildings:compile` (commit the regenerated `compiled.ts` and `recipes.ts`),
   `npm run buildings:check`, `npm run demo:check` and `npm run typecheck`.
6. Open a pull request with viewer screenshots (by day, at night, far) and the checklist below. Use the landmark pull
   request template (`.github/PULL_REQUEST_TEMPLATE/landmark.md`).

**Pull-request checklist for a landmark**

- [ ] One landmark, a draft in `landmark-drafts.ts` with `draft: true` on the kind and the design, and an `author`
- [ ] Kind id in the reserved range 230-249, unused; tags include `draft`
- [ ] Footprint up to 4×4, door on the front row, the model's door on the front inside the door tile
- [ ] Heights follow the 33 m rule and stay within 10 tiles; the silhouette reads at far zoom
- [ ] Palette names or `0xRRGGBB` only; windows by class and facade; nothing drawn by hand over a window
- [ ] `blurb` and `howTo` in the game's voice; no brand names, logos or signage text
- [ ] No moving parts in the recipe; any motion is an exported constant plus a described, separately reviewed client change
- [ ] `landmarks:check`, `buildings:check`, `demo:check`, `typecheck` pass; compiled output committed
- [ ] Viewer screenshots attached

**Review rubric for agents.** Score each 0 (fails), 1 (needs work), 2 (good); accept at 18 or more with no zero. The full
text is in `docs/landmarks.md` section 15.

1. Silhouette: the shape alone says what the building is at far zoom.
2. Footprint: the model fits in all four rotations; the door is on the front row and the model's door is in its tile.
3. Palette: palette names or `0xRRGGBB` only; no saturated `red`, `navy` or `terracotta` walls.
4. Windows: windowed boxes have a facade and a name; doors and bands placed by cell, never over a window; `beacon`,
   `sign` and `fire` used only as lights.
5. Scale: heights agree with the 33 m rule and the London table.
6. Organic rule: nothing visual is a uniform switch; lights and motion phases hash per instance.
7. Moving parts: clock-driven, exported as a constant, per-instance phased, a separate client change.
8. No trademarks: no brand names, logos or signage text.
9. Budget: within 400 ops; repeats with `repeat`, curves with `taper` and `lathe`.
10. Checks green and compiled output committed.
11. `blurb` and `howTo` in the game's voice, accurate, a sentence or two each.

## Code contributions

- `README.md` explains the architecture; `docs/` has a design document per system.
- Run `npm run typecheck`, `npm run buildings:check`, `npm run landmarks:check` and `npm run demo:check` before opening a pull request.
- Keep simulation changes deterministic and cheap per tick; the load tests in `packages/server/src/loadtest/` and
  `docs/traffic-tuning.md` describe how changes are measured.
- Every new kind or feature lands with its place in the Showcase demo and a tour stop, or `demo:check` fails
  (`docs/demo.md`).

## Licence of contributions

Civitas is licensed under the **GNU Affero General Public License v3.0 or later** (see `LICENSE`).

By submitting a contribution (code, designs, documentation or assets) you confirm that you have the right to submit it,
and you agree that:

1. your contribution is licensed under AGPL-3.0-or-later, like the rest of the project; and
2. you grant Rich Green, the project's maintainer, a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   licence to use, modify, sublicense and distribute your contribution, including under licence terms other than the
   AGPL (for example, a commercial licence for running hosted Civitas servers).

You keep the copyright in your contribution. A formal contributor licence agreement (CLA) bot may replace this section
later; contributions made before then stay covered by these terms.

## Name

"Civitas" is the project's name. Forks are welcome under the licence, but please give a fork that you publish or host a
different name, so players can tell it apart from the official servers.
