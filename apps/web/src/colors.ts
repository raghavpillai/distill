// Warm observatory palette tuned for a near-black sky.
// Hand-picked so adjacent hues don't collide on the starmap.
export const PALETTE = [
  "#e7c074", // brass-bright
  "#c7603a", // copper
  "#4c8e89", // verdigris
  "#b08ad4", // periwinkle
  "#e0523c", // ember
  "#7fb8a5", // jade mist
  "#c48b5a", // amber sand
  "#d5b1e3", // lilac dust
  "#9ec8e0", // pale cyan
  "#d0a6a6", // dusty rose
  "#8fbf86", // sage
  "#e7a87d", // peach
  "#6b88c9", // cornflower
  "#e3d36a", // pale gold
  "#a66d8a", // plum
  "#6bb2a8", // seafoam
  "#bc7a5e", // clay
  "#8fa3d4", // periwinkle pale
  "#c69fcf", // orchid
  "#dcb46a", // honey
  "#d47a6b", // coral
  "#89a97a", // olive
  "#b4c37a", // chartreuse
  "#d98aa4", // blush
  "#7b9dc0", // dusk blue
];

export const NOISE_COLOR = "rgba(150, 140, 115, 0.25)";

export function clusterColor(id: number): string {
  if (id < 0) return NOISE_COLOR;
  return PALETTE[id % PALETTE.length]!;
}
