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

Recognisable real buildings (landmarks) are welcome too: see "Landmarks" in `docs/buildings.md` for how the London set is
built (`landmarks-london*.ts`) and how they are unlocked.

## Code contributions

- `README.md` explains the architecture; `docs/` has a design document per system.
- Run `npm run typecheck`, `npm run buildings:check` and `npm run demo:check` before opening a pull request.
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
