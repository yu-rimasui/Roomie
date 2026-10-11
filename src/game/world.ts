export type Area = "home" | "town";
export type View = "overhead" | "first";
export type Player = {
  id: string;
  slot: number;
  area: Area;
  x: number;
  z: number;
  yaw: number;
};
export type Box = { x: number; z: number; w: number; d: number };
export const RADIUS = 0.28;
export const homeObstacles: Box[] = [
  { x: -3.5, z: 0, w: 1.65, d: 3.4 },
  { x: -1.6, z: 0.6, w: 1.4, d: 1.65 },
  { x: 3.35, z: -2.3, w: 2.5, d: 3.6 },
  { x: -2.9, z: -4.45, w: 4.1, d: 0.65 },
  { x: 4.8, z: 2.85, w: 0.8, d: 0.8 },
  { x: 1, z: -4.4, w: 1.2, d: 0.8 },
];
export const buildings = [
  { x: 0, z: 0, w: 10, d: 8, color: "#d8b589", roof: "#6e8871", name: "home" },
  {
    x: -13,
    z: -8,
    w: 5,
    d: 5,
    color: "#e4c5a9",
    roof: "#c78369",
    name: "studio",
  },
  {
    x: 13,
    z: -9,
    w: 5,
    d: 6,
    color: "#d9d8b9",
    roof: "#8e9b75",
    name: "house",
  },
  {
    x: -14,
    z: 10,
    w: 4.5,
    d: 4.5,
    color: "#e8d6b3",
    roof: "#8b9ca2",
    name: "house",
  },
];
export const trees = [
  [-8, -13],
  [-14, -15],
  [-19, -5],
  [-9, 3],
  [-19, 3],
  [-19, 15],
  [-8, 15],
  [8, -14],
  [18, -15],
  [19, -3],
  [18, 15],
  [6, 17],
  [14, 3],
  [-3, -17],
];
export const townObstacles: Box[] = [
  ...buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
  ...trees.map(([x, z]) => ({ x, z, w: 1, d: 1 })),
  { x: 11, z: 10, w: 3.8, d: 0.9 },
  { x: 7, z: 9, w: 1, d: 1 },
];
export function blocked(area: Area, x: number, z: number) {
  const limit = area === "home" ? [5.7, 4.7] : [21, 21];
  if (Math.abs(x) > limit[0] || Math.abs(z) > limit[1]) return true;
  return (area === "home" ? homeObstacles : townObstacles).some(
    (b) =>
      Math.abs(x - b.x) < b.w / 2 + RADIUS &&
      Math.abs(z - b.z) < b.d / 2 + RADIUS,
  );
}
export function move(
  player: Player,
  dx: number,
  dz: number,
  dt: number,
): boolean {
  if (!dx && !dz) return false;
  const length = Math.hypot(dx, dz);
  const step = Math.min(dt, 0.05) * 3;
  const x = player.x + (dx / length) * step,
    z = player.z + (dz / length) * step;
  if (player.area === "home" && Math.abs(x) < 0.8 && z > 4.55) {
    Object.assign(player, { area: "town", x: 0, z: 6.2 });
    return true;
  }
  if (
    player.area === "town" &&
    Math.abs(x) < 0.8 &&
    z < 4.9 &&
    z > 4 &&
    dz < 0
  ) {
    Object.assign(player, { area: "home", x: 0, z: 4.1 });
    return true;
  }
  if (!blocked(player.area, x, player.z)) player.x = x;
  if (!blocked(player.area, player.x, z)) player.z = z;
  return false;
}
export function validPlayer(value: unknown): value is Player {
  if (!value || typeof value !== "object") return false;
  const p = value as Player;
  return (
    typeof p.id === "string" &&
    p.id.length <= 64 &&
    (p.slot === 0 || p.slot === 1) &&
    (p.area === "home" || p.area === "town") &&
    [p.x, p.z, p.yaw].every(Number.isFinite) &&
    Math.abs(p.x) <= 22 &&
    Math.abs(p.z) <= 22 &&
    Math.abs(p.yaw) <= Math.PI * 4
  );
}
export function spawn(id: string, slot = 0): Player {
  return {
    id,
    slot,
    area: "home",
    x: slot === 0 ? 0.7 : 1.6,
    z: 2.8,
    yaw: Math.PI,
  };
}
