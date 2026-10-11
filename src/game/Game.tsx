import { useEffect, useRef } from "react";
import * as T from "three";
import { disposeObject, makeAvatar, makeWorld } from "./scene";
import { move, type Area, type Player, type View } from "./world";
export type GameProps = {
  player: Player;
  peers: Player[];
  view: View;
  paused: boolean;
  onArea: (a: Area) => void;
  onView: () => void;
  onMove: (p: Player) => void;
  onError: (message: string) => void;
  turn: number;
};
export default function Game(props: GameProps) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!host.current) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      latest.current.onError(
        "3D表示を開始できません。WebGL対応ブラウザで開いてください。",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.setClearColor("#e7e6d5");
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    host.current.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.fog = new T.Fog("#dce4cb", 28, 65);
    scene.add(new T.HemisphereLight("#fff4dd", "#9da889", 3));
    const sun = new T.DirectionalLight("#fff0cf", 4);
    sun.position.set(-7, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const ground = new T.Mesh(
      new T.PlaneGeometry(200, 200),
      new T.MeshStandardMaterial({ color: "#e7e6d5", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    scene.add(ground);
    // shortcut: both small maps load at startup; split assets when the world grows.
    const worlds = { home: makeWorld("home"), town: makeWorld("town") };
    scene.add(worlds.home, worlds.town);
    worlds.town.visible = false;
    const avatars = [makeAvatar(0), makeAvatar(1)];
    avatars.forEach((a) => scene.add(a));
    const ortho = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 150),
      first = new T.PerspectiveCamera(65, 1, 0.05, 100);
    first.layers.enable(1);
    let aspect = 1;
    const resize = () => {
      if (!host.current) return;
      const { width, height } = host.current.getBoundingClientRect();
      aspect = width / height;
      renderer.setSize(width, height);
      ortho.left = -9.1 * aspect;
      ortho.right = 9.1 * aspect;
      ortho.top = 9.1;
      ortho.bottom = -9.1;
      ortho.updateProjectionMatrix();
      first.aspect = aspect;
      first.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const keys = new Set<string>();
    const down = (e: KeyboardEvent) => {
      if (latest.current.paused || e.target instanceof HTMLInputElement) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "KeyV",
          "KeyQ",
          "KeyE",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      )
        e.preventDefault();
      keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "KeyV") latest.current.onView();
      if (e.code === "KeyQ")
        latest.current.player.yaw = normalize(
          latest.current.player.yaw + Math.PI / 2,
        );
      if (e.code === "KeyE")
        latest.current.player.yaw = normalize(
          latest.current.player.yaw - Math.PI / 2,
        );
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    let previous = performance.now(),
      frame = 0,
      oldArea: Area = "home",
      oldView: View = "overhead",
      oldTurn = latest.current.turn;
    const target = new T.Vector3(),
      look = new T.Vector3(),
      remote = new T.Vector3();
    function normalize(yaw: number) {
      return Math.atan2(Math.sin(yaw), Math.cos(yaw));
    }
    function loop(now: number) {
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const p = latest.current.player;
      if (latest.current.turn !== oldTurn) {
        p.yaw = normalize(
          p.yaw + (Math.PI / 2) * (latest.current.turn - oldTurn),
        );
        oldTurn = latest.current.turn;
      }
      let dx = 0,
        dz = 0;
      if (!latest.current.paused) {
        dx =
          Number(keys.has("KeyD") || keys.has("ArrowRight")) -
          Number(keys.has("KeyA") || keys.has("ArrowLeft"));
        dz =
          Number(keys.has("KeyS") || keys.has("ArrowDown")) -
          Number(keys.has("KeyW") || keys.has("ArrowUp"));
        if (latest.current.view === "first") {
          const side = dx,
            forward = -dz;
          dx = Math.cos(p.yaw) * -side + Math.sin(p.yaw) * forward;
          dz = Math.sin(p.yaw) * side + Math.cos(p.yaw) * forward;
        } else if (dx || dz) p.yaw = Math.atan2(dx, dz);
        move(p, dx, dz, dt);
      } else keys.clear();
      if (p.area !== oldArea) {
        oldArea = p.area;
        latest.current.onArea(p.area);
      }
      const zoom = p.area === "home" ? 9.1 / 10 : 9.1 / 11.5;
      if (ortho.zoom !== zoom) {
        ortho.zoom = zoom;
        ortho.updateProjectionMatrix();
      }
      worlds.home.visible = p.area === "home";
      worlds.town.visible = p.area === "town";
      ground.material.color.set(p.area === "home" ? "#e7e6d5" : "#b5c49d");
      renderer.setClearColor(p.area === "home" ? "#e7e6d5" : "#dce4cb");
      const self = avatars[p.slot];
      self.position.set(p.x, 0, p.z);
      self.rotation.y = p.yaw;
      self.visible = latest.current.view === "overhead";
      if (dx || dz) self.position.y = Math.sin(now * 0.013) * 0.035;
      const other = avatars[1 - p.slot],
        peer = latest.current.peers.find((other) => other.area === p.area);
      if (peer) {
        if (!other.visible) other.position.set(peer.x, 0, peer.z);
        remote.set(peer.x, 0, peer.z);
        other.position.lerp(remote, 1 - Math.exp(-dt * 14));
        other.rotation.y = peer.yaw;
        other.visible = true;
      } else other.visible = false;
      if (latest.current.view === "overhead") {
        target.set(p.x + 10, 14, p.z + 15);
        look.set(p.x, 0.2, p.z - 0.2);
        if (oldView === "first") ortho.position.copy(target);
        else ortho.position.lerp(target, 1 - Math.exp(-dt * 7));
        ortho.lookAt(look);
        renderer.render(scene, ortho);
      } else {
        first.position.set(p.x, 1.43, p.z);
        look.set(p.x + Math.sin(p.yaw), 1.43, p.z + Math.cos(p.yaw));
        first.lookAt(look);
        renderer.render(scene, first);
      }
      oldView = latest.current.view;
      latest.current.onMove(p);
      frame = requestAnimationFrame(loop);
    }
    ortho.position.set(10, 14, 15);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="game-canvas"
      ref={host}
      aria-label="Roomieの3Dゲーム。WASDで移動、Vで視点切り替え。"
      role="img"
    />
  );
}
