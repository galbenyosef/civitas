/** Named colours recipes may use. Any 0xRRGGBB number works too. */
export const PALETTE = {
  cream: 0xf2e4c9, white: 0xf6f2ea, pale: 0xd8dde6, stone: 0xd7d2c8, brick: 0xc8704c, grey: 0xb8bcc5, dark: 0x3a3e49,
  slate: 0x4b5262, terracotta: 0xb8472f, glass: 0x74a9db, glassDark: 0x4e7fb8, corrugated: 0xa9abb0, rust: 0x9d5b30,
  chimney: 0x6b6e74, yellow: 0xe6b734, navy: 0x2d4a9c, red: 0xcb3b2d, crossRed: 0xdc3026, brown: 0x8d5b2c,
  sand: 0xd9c38e, signBlue: 0x2f8fd6, awning: 0xd94f4f, door: 0x4a3326, steel: 0xc9ccd2, plant: 0x5b6068, roofGrey: 0x8f949c,
  tan: 0xcdb38f, green: 0x3f6b4f, silver: 0xdfe3e8, charcoal: 0x2b2e36, timber: 0x5a3d26, mint: 0xcfe6d8,
  boxBlue: 0x2f6fb5, boxOrange: 0xd9752b, boxGreen: 0x4f9a5c, flare: 0xff7a30,
  // leisure: lawns, gravel paths, water, hedges, court lines, marquee bulbs
  lawn: 0x6fa857, lawnDark: 0x5a9147, gravel: 0xd9cfb4, pond: 0x4f8fc9, hedge: 0x3f7a3a, court: 0xc4683f, gold: 0xd8b25a, marquee: 0xfff1b8, plum: 0x6e3b5c,
};
export type PaletteName = keyof typeof PALETTE;

/**
 * Window schedule classes, carried per vertex in `aWin` and read by the
 * building shader (render/materials.ts `Win` must match these numbers).
 * `fire` is not a window: a camp fire or a lantern, the whole box glowing from
 * dusk and flickering on its own phase per building.
 */
export const WINDOW_CLASSES = { none: 0, home: 1, shop: 2, office: 3, civic: 4, factory: 5, venue: 6, fire: 7 } as const;
export type WindowClass = keyof typeof WINDOW_CLASSES;
