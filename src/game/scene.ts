import * as T from "three";
import { buildings, trees, type Area } from "./world";
const palette = {
  wood: "#a77c53",
  dark: "#72583d",
  cream: "#eee6d5",
  green: "#819b70",
  leaf: "#7e9b6a",
};
function material(color: string, roughness = 0.85) {
  return new T.MeshStandardMaterial({ color, roughness });
}
function box(
  parent: T.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  r = 0,
) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), material(color));
  m.position.set(x, y, z);
  m.rotation.y = r;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function sphere(
  parent: T.Object3D,
  r: number,
  x: number,
  y: number,
  z: number,
  color: string,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const m = new T.Mesh(new T.SphereGeometry(r, 16, 12), material(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function cylinder(
  parent: T.Object3D,
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: string,
) {
  const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 20), material(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function plant(parent: T.Object3D, x: number, z: number, size = 1) {
  cylinder(
    parent,
    0.28 * size,
    0.2 * size,
    0.5 * size,
    x,
    0.25 * size,
    z,
    "#c59173",
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    sphere(
      parent,
      0.3 * size,
      x + Math.sin(a) * 0.17 * size,
      (0.65 + (i % 2) * 0.2) * size,
      z + Math.cos(a) * 0.17 * size,
      palette.leaf,
      0.5,
      1.6,
      0.7,
    );
  }
}
function table(parent: T.Object3D, x: number, z: number, w: number, d: number) {
  box(parent, w, 0.13, d, x, 0.8, z, "#b78c61");
  for (const a of [-1, 1])
    for (const b of [-1, 1])
      box(
        parent,
        0.09,
        0.75,
        0.09,
        x + a * (w / 2 - 0.13),
        0.38,
        z + b * (d / 2 - 0.13),
        palette.wood,
      );
}
function rug(parent: T.Object3D, x: number, z: number, w: number, d: number) {
  box(parent, w, 0.025, d, x, 0.025, z, "#d7b798");
  box(parent, w - 0.18, 0.028, d - 0.18, x, 0.03, z, "#e4cdb0");
  for (let i = 0; i < 12; i++)
    box(
      parent,
      0.024,
      0.01,
      d - 0.4,
      x - w / 2 + 0.3 + (i * (w - 0.6)) / 11,
      0.05,
      z,
      "#c3a784",
    );
  for (let i = 0; i < 16; i++)
    for (const a of [-1, 1])
      box(
        parent,
        0.045,
        0.02,
        0.18,
        x - w / 2 + 0.12 + (i * (w - 0.24)) / 15,
        0.028,
        z + a * (d / 2 + 0.06),
        "#d7b798",
      );
}
function windowFrame(
  parent: T.Object3D,
  x: number,
  z: number,
  w: number,
  side = false,
) {
  const group = new T.Group();
  group.position.set(x, 1.95, z);
  if (side) group.rotation.y = Math.PI / 2;
  parent.add(group);
  box(group, w + 0.2, 1.75, 0.12, 0, 0, 0, palette.cream);
  box(group, w, 1.55, 0.14, 0, 0, 0.02, "#bfd7d2");
  box(group, 0.07, 1.55, 0.18, 0, 0, 0.09, "#f5ead7");
  box(group, w, 0.07, 0.18, 0, 0, 0.09, "#f5ead7");
  box(group, w + 0.45, 0.12, 0.35, 0, -0.9, 0.1, palette.wood);
  for (const s of [-1, 1])
    box(group, 0.28, 1.9, 0.2, s * (w / 2 + 0.15), 0.05, 0.2, "#e6d6b9");
}
export function makeHome() {
  const root = new T.Group();
  box(root, 12, 0.3, 10, 0, -0.17, 0, "#93734f");
  for (let z = 0; z < 20; z++)
    for (let x = 0; x < (z % 2 ? 7 : 6); x++) {
      const edge = Boolean(z % 2 && (x === 0 || x === 6));
      const px =
        z % 2 ? (x === 0 ? -5.5 : x === 6 ? 5.5 : -6 + x * 2) : -5 + x * 2;
      box(
        root,
        edge ? 0.98 : 1.98,
        0.06,
        0.48,
        px,
        -0.005,
        -4.75 + z * 0.5,
        ["#c9a57a", "#c3a075", "#d0ad82", "#c4a079"][(x + z * 3) % 4],
      );
    }
  box(root, 12, 3.5, 0.18, 0, 1.75, -5, "#e8e0c9");
  box(root, 0.18, 3.5, 10, -6, 1.75, 0, "#e4dac3");
  box(root, 12, 0.2, 0.22, 0, 0.12, -4.85, palette.wood);
  box(root, 0.22, 0.2, 10, -5.85, 0.12, 0, palette.wood);
  box(root, 12, 0.12, 0.3, 0, 3.5, -5, palette.wood);
  box(root, 0.3, 0.12, 10, -6, 3.5, 0, palette.wood);
  for (let z = -4; z <= 4; z += 2)
    box(root, 0.08, 3.4, 0.1, -5.87, 1.7, z, "#d0c5ad");
  windowFrame(root, -5.85, -1.7, 2.1, true);
  windowFrame(root, 3.3, -4.86, 2.5);
  // A cutaway wall keeps the shared room visible from above.
  box(root, 0.18, 0.3, 10, 6, 0.15, 0, "#d1bc99");
  box(root, 5, 0.3, 0.18, -3.5, 0.15, 5, "#d1bc99");
  box(root, 5, 0.3, 0.18, 3.5, 0.15, 5, "#d1bc99");
  // The first-person camera includes these full walls; the overhead camera cuts them away.
  for (const wall of [
    box(root, .18, 3.5, 10, 6, 1.75, 0, "#e8e0c9"),
    box(root, 5, 3.5, .18, -3.5, 1.75, 5, "#e8e0c9"),
    box(root, 5, 3.5, .18, 3.5, 1.75, 5, "#e8e0c9"),
    box(root, 2, .8, .18, 0, 3.1, 5, "#e8e0c9"),
    box(root, .12, 2.7, .24, -1, 1.35, 4.95, palette.wood),
    box(root, .12, 2.7, .24, 1, 1.35, 4.95, palette.wood),
    box(root, 2.12, .12, .24, 0, 2.7, 4.95, palette.wood),
  ]) {
    wall.layers.set(1);
    wall.castShadow = false;
  }

  box(root, 1.8, 0.04, 0.8, 0, 0.035, 4.5, "#8e9a78");
  for (let i = 0; i < 5; i++)
    box(root, 1.5, 0.01, 0.02, 0, 0.06, 4.2 + i * 0.14, "#b5bda6");
  // Sofa, with individually modeled cushions and timber feet.
  box(root, 1.65, 0.5, 3.4, -3.5, 0.5, 0, "#6f876d");
  box(root, 0.32, 1.25, 3.4, -4.15, 0.95, 0, "#829678");
  for (const z of [-1.5, 1.5])
    box(root, 1.65, 1, 0.28, -3.5, 0.85, z, "#829678");
  for (const z of [-0.9, 0, 0.9])
    box(root, 1.17, 0.24, 0.86, -3.35, 0.87, z, "#a3ae8e");
  box(root, 0.6, 0.55, 0.65, -3.78, 1.25, -0.85, "#d4b68e", 0.12);
  box(root, 0.6, 0.55, 0.65, -3.75, 1.25, 0.8, "#dec9ab", -0.15);
  for (const z of [-1.3, 1.3])
    box(root, 0.1, 0.3, 0.1, -3.3, 0.15, z, palette.dark);
  rug(root, -1.7, 1, 3.5, 3.8);
  table(root, -1.6, 0.6, 1.4, 1.65);
  box(root, 0.42, 0.045, 0.55, -1.72, 0.89, 0.85, "#81918b", 0.12);
  box(root, 0.45, 0.04, 0.57, -1.72, 0.93, 0.85, "#e6ddc5", 0.12);
  cylinder(root, 0.12, 0.1, 0.18, -1.4, 0.95, 0.2, "#f3e9d9");
  cylinder(root, 0.085, 0.085, 0.006, -1.4, 1.045, 0.2, "#70513c");
  plant(root, -1.8, 0.18, 0.38);
  // Bed and nightstand.
  box(root, 2.5, 0.45, 3.6, 3.35, 0.32, -2.3, palette.wood);
  box(root, 2.35, 0.4, 3.45, 3.35, 0.72, -2.3, "#f0e4cf");
  box(root, 2.4, 0.12, 2.35, 3.35, 0.97, -1.76, "#91a08c");
  for (let i = 0; i < 11; i++)
    box(root, 0.04, 0.01, 2.2, 2.27 + i * 0.21, 1.035, -1.76, "#c2cbbb");
  box(root, 2.6, 1.35, 0.16, 3.35, 0.8, -4.1, palette.wood);
  for (const x of [2.73, 3.95])
    box(root, 0.94, 0.22, 0.65, x, 1.02, -3.5, "#f7eedf");
  table(root, 1, -4.4, 1.2, 0.8);
  cylinder(root, 0.17, 0.24, 0.24, 1, 1, -4.4, "#d4b17c");
  cylinder(root, 0.025, 0.025, 0.42, 1, 1.3, -4.4, palette.dark);
  cylinder(root, 0.4, 0.3, 0.4, 1, 1.65, -4.4, "#ead7aa");
  // Bookshelf: fixed, original geometry and deterministic book colors.
  box(root, 4.1, 2.6, 0.65, -2.9, 1.3, -4.45, palette.dark);
  for (let row = 0; row < 3; row++) {
    box(root, 3.9, 0.09, 0.7, -2.9, 0.25 + row * 0.79, -4.37, palette.wood);
    for (let i = 0; i < 17; i++)
      box(
        root,
        0.15,
        0.4 + (i % 3) * 0.11,
        0.35,
        -4.7 + i * 0.225,
        0.55 + row * 0.79,
        -4.2,
        ["#a66d57", "#93a28c", "#cfb787", "#8b9da3", "#d3c4a2"][i % 5],
      );
  }
  for (const x of [-5, -0.85])
    box(root, 0.12, 2.65, 0.7, x, 1.3, -4.4, palette.wood);
  plant(root, 4.8, 2.85, 1.3);
  plant(root, -5, 3.4, 1.1);
  cylinder(root, 0.35, 0.35, 0.05, -4.8, 2.8, -4.1, "#c7b284");
  const art = box(root, 1.15, 0.9, 0.08, -1, 2.85, -4.86, palette.wood);
  void art;
  box(root, 0.95, 0.7, 0.09, -1, 2.85, -4.8, "#ddd4b9");
  sphere(root, 0.2, -1.1, 2.85, -4.73, "#8f9c77", 1, 1, 0.1);
  // Pendant above the room.
  cylinder(root, 0.018, 0.018, 0.5, -0.3, 3.8, 0.5, palette.dark);
  cylinder(root, 0.22, 0.65, 0.55, -0.3, 3.3, 0.5, "#d4b688");
  const light = new T.PointLight("#ffe0a0", 8, 10, 2);
  light.position.set(-0.3, 2.9, 0.5);
  root.add(light);
  return root;
}
function tree(parent: T.Object3D, x: number, z: number, index: number) {
  const h = 2.4 + (index % 3) * 0.3;
  cylinder(parent, 0.22, 0.35, h, x, h / 2, z, "#94764e");
  sphere(
    parent,
    1.5,
    x,
    h + 0.6,
    z,
    ["#7c9666", "#8fa473", "#6f8e65"][index % 3],
    1,
    1.2,
    1,
  );
  sphere(parent, 1, x - 0.7, h + 0.25, z + 0.35, "#91a474");
  sphere(parent, 0.95, x + 0.8, h + 0.35, z - 0.1, "#819a69");
}
function bench(parent: T.Object3D, x: number, z: number) {
  for (const a of [-1, 1])
    box(parent, 0.12, 0.7, 0.8, x + a * 1.5, 0.35, z, "#626f60");
  for (let i = 0; i < 4; i++)
    box(parent, 3.8, 0.12, 0.14, x, 0.72, z - 0.3 + i * 0.2, "#b79569");
  for (let i = 0; i < 3; i++)
    box(parent, 3.8, 0.15, 0.1, x, 0.98 + i * 0.2, z - 0.45, "#b79569");
}
export function makeTown() {
  const root = new T.Group();
  box(root, 45, 0.4, 45, 0, -0.25, 0, "#a2b783");
  box(root, 3, 0.035, 43, 0, 0.01, 0, "#dbca9e");
  box(root, 39, 0.035, 3, 0, 0.015, 7, "#dbca9e");
  box(root, 11, 0.04, 10, 11, 0.01, 11, "#acbd90");
  for (let i = 0; i < 30; i++)
    for (const s of [-1, 1])
      box(root, 0.22, 0.04, 0.5, s * 1.65, 0.015, -21 + i * 1.45, "#eee0b9");
  for (const b of buildings) {
    box(root, b.w, 0.3, b.d, b.x, 0.15, b.z, "#b7a17f");
    box(root, b.w - 0.2, 3.5, b.d - 0.2, b.x, 1.9, b.z, b.color);
    for (let y = 0.7; y < 3.5; y += 0.4)
      box(root, b.w - 0.1, 0.025, 0.02, b.x, y, b.z + b.d / 2, "#bca98a");
    const w = (b.w + 1) / 2,
      d = (b.d + 1) / 2;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [-w, 0, -d, w, 0, -d, 0, 1.9, -d, -w, 0, d, w, 0, d, 0, 1.9, d],
        3,
      ),
    );
    geometry.setIndex([
      0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3,
    ]);
    const flat = geometry.toNonIndexed();
    flat.computeVertexNormals();
    geometry.dispose();
    const roof = new T.Mesh(flat, material(b.roof));
    roof.position.set(b.x, 3.7, b.z);
    roof.castShadow = true;
    roof.receiveShadow = true;
    root.add(roof);
    box(root, 1.25, 2.2, 0.08, b.x, 1.2, b.z + b.d / 2, "#8d7554");
    sphere(root, 0.055, b.x + 0.4, 1.2, b.z + b.d / 2 + 0.08, "#e5c593");
    for (const s of [-1, 1]) {
      windowFrame(root, b.x + s * b.w * 0.31, b.z + b.d / 2 + 0.02, 1);
      box(
        root,
        1.4,
        0.25,
        0.4,
        b.x + s * b.w * 0.31,
        0.9,
        b.z + b.d / 2 + 0.15,
        b.roof,
      );
    }
    if (b.name === "home") {
      box(root, 2, 0.18, 1.2, 0, 0.18, 4.4, "#c9b18a");
      box(root, 1.6, 0.08, 0.6, 0, 0.07, 5, "#d5c2a0");
    }
  }
  trees.forEach(([x, z], i) => tree(root, x, z, i));
  bench(root, 11, 10);
  bench(root, 11, 14);
  cylinder(root, 0.55, 0.65, 0.5, 7, 0.25, 9, "#b8a184");
  plant(root, 7, 9, 1);
  for (const [x, z] of [
    [-3, 8],
    [3, -7],
    [16, 7],
    [-12, 7],
  ]) {
    cylinder(root, 0.1, 0.17, 3, x, 1.5, z, "#6e7865");
    box(root, 0.6, 0.65, 0.6, x, 3, z, "#e9d9b0");
    box(root, 0.8, 0.12, 0.8, x, 3.38, z, "#6e7865");
  }
  // Small flower beds are scenery, with no gathering or gardening mechanics.
  for (let i = 0; i < 36; i++) {
    const x = 6 + (i % 9) * 0.53,
      z = 17 + Math.floor(i / 9) * 0.5;
    cylinder(root, 0.018, 0.018, 0.3, x, 0.15, z, "#718d5d");
    sphere(root, 0.12, x, 0.35, z, ["#d3a08c", "#e7c684", "#f2e6c8"][i % 3]);
  }
  for (let i = 0; i < 80; i++) {
    const x = Math.sin(i * 37.1) * 20,
      z = Math.cos(i * 19.3) * 20;
    if (Math.abs(x) < 2 || Math.abs(z - 7) < 2) continue;
    box(root, 0.14, 0.025, 0.25, x, 0.012, z, "#92a873", i);
  }
  return root;
}
export function makeAvatar(slot: number) {
  const g = new T.Group();
  const shirt = slot === 0 ? "#bf8068" : "#7e9fa4";
  cylinder(g, 0.25, 0.32, 0.63, 0, 0.72, 0, shirt);
  sphere(g, 0.31, 0, 1.32, 0, "#e5bf97", 1, 1.12, 1);
  sphere(
    g,
    0.325,
    0,
    1.48,
    -0.04,
    slot === 0 ? "#70533d" : "#514a41",
    1,
    0.62,
    1,
  );
  for (const s of [-1, 1]) {
    box(g, 0.18, 0.35, 0.2, s * 0.15, 0.27, 0, "#786e59");
    sphere(g, 0.13, s * 0.15, 0.12, 0.08, "#eae0cc", 1, 0.6, 1.5);
    sphere(g, 0.11, s * 0.33, 0.72, 0.02, "#e5bf97", 0.85, 1.7, 0.9);
    sphere(g, 0.035, s * 0.115, 1.34, 0.29, "#544638", 1, 1.2, 0.5);
    sphere(g, 0.05, s * 0.2, 1.24, 0.26, "#d8a08b", 1, 0.5, 0.4);
  }
  const shadow = new T.Mesh(
    new T.CircleGeometry(0.36, 24),
    new T.MeshBasicMaterial({
      color: "#4c5940",
      transparent: true,
      opacity: 0.12,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  g.add(shadow);
  return g;
}
export function makeWorld(area: Area) {
  return area === "home" ? makeHome() : makeTown();
}
export function disposeObject(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
}
