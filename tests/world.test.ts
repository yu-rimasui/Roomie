import { describe, it, expect } from "vitest";
import {
  blocked,
  move,
  spawn,
  validPlayer,
  homeObstacles,
  townObstacles,
} from "../src/game/world";
import { liveMembers, inviteCode } from "../src/network/room";
describe("shared world", () => {
  it("moves smoothly and normalizes diagonals", () => {
    const a = spawn("a"),
      b = spawn("b");
    a.x = b.x = 0;
    a.z = b.z = 2.8;
    move(a, 1, 0, 0.05);
    move(b, 1, 1, 0.05);
    expect(Math.hypot(a.x, a.z - 2.8)).toBeCloseTo(Math.hypot(b.x, b.z - 2.8));
  });
  it("blocks furniture, buildings, trees and world edges", () => {
    for (const [area, obstacles] of [
      ["home", homeObstacles],
      ["town", townObstacles],
    ] as const)
      for (const b of obstacles) expect(blocked(area, b.x, b.z)).toBe(true);
    expect(blocked("home", 5.8, 0)).toBe(true);
    expect(blocked("town", 22, 0)).toBe(true);
  });
  it("does not cross a sofa even after a delayed frame", () => {
    const p = spawn("a");
    p.x = -2.3;
    p.z = -0.8;
    for (let i = 0; i < 100; i++) move(p, -1, 0, 10);
    expect(p.x).toBeGreaterThan(-2.4);
  });
  it("walks through the door in both directions without an immediate bounce", () => {
    const p = spawn("a");
    p.x = 0;
    p.z = 4.5;
    expect(move(p, 0, 1, 0.05)).toBe(true);
    expect(p.area).toBe("town");
    expect(move(p, 0, 1, 0.05)).toBe(false);
    for (let i = 0; i < 30 && p.area === "town"; i++) move(p, 0, -1, 0.05);
    expect(p.area).toBe("home");
    expect(p.z).toBe(4.1);
  });
  it("does not allow exiting through other wall segments", () => {
    const p = spawn("a");
    p.x = 2;
    p.z = 4.5;
    for (let i = 0; i < 20; i++) move(p, 0, 1, 0.05);
    expect(p.area).toBe("home");
    expect(p.z).toBeLessThanOrEqual(4.7);
  });
  it("rejects malformed network state", () => {
    expect(validPlayer(spawn("a"))).toBe(true);
    for (const invalid of [
      { x: Infinity },
      { area: "unknown" },
      { slot: 2 },
      { yaw: NaN },
      { z: 100 },
    ])
      expect(validPlayer({ ...spawn("a"), ...invalid })).toBe(false);
  });
});
describe("local room boundaries", () => {
  it("ignores malformed stored memberships", () => {
    expect(liveMembers([null, { player: null }, "bad"], 1000)).toEqual([]);
    expect(liveMembers({}, 1000)).toEqual([]);
  });
  it("expires disconnected participants", () => {
    const p = spawn("a");
    expect(
      liveMembers(
        [
          { player: p, seen: 1000 },
          { player: spawn("b"), seen: 8500 },
        ],
        10000,
      ),
    ).toHaveLength(1);
  });
  it("parses invite URLs and rejects malformed URLs", () => {
    expect(inviteCode("https://example.test/#invite=local.abc")).toBe(
      "local.abc",
    );
    expect(inviteCode("not://a")).toBe("");
  });
});
