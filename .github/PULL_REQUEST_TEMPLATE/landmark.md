<!-- Landmark pull request. The brief is docs/landmarks.md; the rubric is its section 15. -->

## The landmark

Name, what it is and where it stands (or the type, for a generic one), kind id (230-249), footprint:

## Screenshots

By day, at night and far (from `/viewer.html?tag=draft`):

## Checklist

- [ ] One landmark, a draft in `packages/shared/src/buildings/landmark-drafts.ts`: `draft: true` on the kind and the design, `author` set
- [ ] Kind id in the reserved range 230-249, unused; tags include `draft`
- [ ] Footprint up to 4×4, door on the front row, the model's door on the front inside the door tile
- [ ] Heights follow the 33 m rule and stay within 10 tiles; the silhouette reads at far zoom
- [ ] Palette names or `0xRRGGBB` only; windows by class and facade; nothing drawn by hand over a window
- [ ] `blurb` and `howTo` in the game's voice; no brand names, logos or signage text
- [ ] No moving parts in the recipe; any motion is an exported constant plus a described, separately reviewed client change
- [ ] `npm run buildings:compile` committed; `npm run landmarks:check`, `buildings:check`, `demo:check` and `typecheck` pass
- [ ] Viewer screenshots attached

## Review rubric (reviewer: 0, 1 or 2 each; accept at 18 or more with no zero)

1. Silhouette reads at far zoom: 
2. Fits the footprint in all four rotations, door on the front: 
3. Palette only: 
4. Windows classed and faced, nothing over a window: 
5. Scale against the 33 m rule: 
6. Organic rule respected: 
7. Moving parts clock-driven and separate: 
8. No trademarks: 
9. Op budget: 
10. Checks green: 
11. Blurb and howTo in the game's voice: 

By submitting this you confirm the licence terms in CONTRIBUTING.md.
