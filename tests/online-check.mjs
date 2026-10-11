// Runs against a dedicated configured Supabase project; creates 3 users and 2 rooms.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";

const env = loadEnv("online", process.cwd(), "VITE_SUPABASE_");
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url || "") || !key?.startsWith("sb_publishable_")) {
  console.error("未実行: Supabase URLとsb_publishable_形式の公開キーを設定してください。秘密キーは使用できません。");
  process.exit(1);
}
const clients = [];
function client(storage) {
  const c = createClient(url, key, {
    auth: { storage, storageKey: "roomie-auth", persistSession: Boolean(storage), autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  clients.push(c);
  return c;
}
function checked(result, message) {
  assert(!result.error, message);
  return result.data;
}
async function until(check, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
function watch(c, room, id) {
  const updates = [];
  let postgresReady = false;
  const channel = c.channel(`room:${room}`, { config: { private: true, presence: { key: id } } })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_members", filter: `room_id=eq.${room}` }, ({ new: row }) => updates.push(row))
    .on("system", {}, (payload) => {
      if (payload.extension === "postgres_changes") postgresReady = payload.status === "ok";
    })
    .on("presence", { event: "sync" }, () => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime接続タイムアウト")), 15000);
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          assert.equal(await channel.track({ online: true }), "ok", "Presence送信失敗");
          clearTimeout(timer);
          resolve();
        } catch {
          clearTimeout(timer);
          reject(new Error("Presence送信失敗"));
        }
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timer);
        reject(new Error("Realtime接続失敗"));
      }
    });
  });
  return { channel, updates, ready: ready.then(() => until(() => postgresReady, "Postgres変更配信の準備が完了しない")) };
}
async function denyPresence(c, room, id) {
  const channel = c.channel(`room:${room}`, { config: { private: true, presence: { key: id } } });
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("NO_RESPONSE"), 15000);
    channel.subscribe((s) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  await c.removeChannel(channel);
  assert.equal(status, "CHANNEL_ERROR", "非メンバーのPresence参加が明示的に拒否されること");
}

try {
  const unauthenticated = client();
  assert((await unauthenticated.rpc("create_room")).error, "未認証RPC拒否");
  const people = [];
  for (let i = 0; i < 3; i++) {
    const saved = new Map();
    const storage = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    };
    const c = client(storage);
    const auth = checked(await c.auth.signInAnonymously(), "匿名認証失敗");
    assert(auth.session, "匿名セッションが必要");
    await c.realtime.setAuth(auth.session.access_token);
    people.push({ c, id: auth.user.id, storage });
  }
  const [host, a, b] = people;
  const creation = await Promise.all([host.c.rpc("create_room"), host.c.rpc("create_room")]);
  assert.equal(creation.filter((r) => !r.error).length, 1, "同時作成の成功は1件だけ");
  assert.equal(creation.filter((r) => r.error?.code === "PT429").length, 1, "同時作成の残りは頻度制限で拒否");
  const room = checked(creation.find((r) => !r.error), "ルーム作成失敗");
  const join = (p, token = room.invite_token, rid = room.room_id) => p.c.rpc("join_room", { target_room: rid, invite_token: token });
  assert((await a.c.rpc("rotate_invite", { target_room: room.room_id })).error, "非作成者の招待再発行拒否");
  const originalToken = room.invite_token;
  room.invite_token = checked(await host.c.rpc("rotate_invite", { target_room: room.room_id }), "招待再発行失敗");
  assert.notEqual(room.invite_token, originalToken, "再発行でトークンが変わること");
  assert.equal((await join(a, originalToken)).error?.message, "Invalid invite", "旧招待リンク拒否");
  assert.equal((await host.c.rpc("rotate_invite", { target_room: room.room_id })).error?.code, "PT429", "再発行頻度制限");
  for (const token of [null, "", "x", "0".repeat(48)]) {
    assert.equal((await join(a, token)).error?.message, "Invalid invite", "不正招待が拒否されること");
  }
  assert.equal((await join(a, room.invite_token, "00000000-0000-0000-0000-000000000000")).error?.message, "Invalid invite", "存在しないルーム拒否");
  const members = (p) => p.c.from("room_members").select("user_id,slot,area,x,z,yaw").eq("room_id", room.room_id);
  assert.equal(checked(await members(host), "メンバー読取失敗").length, 1, "不正招待で枠が消費されないこと");
  const race = await Promise.all([join(a), join(b)]);
  assert.equal(race.filter((r) => !r.error && r.data === 1).length, 1, "同時参加の成功は1人だけ");
  assert.equal(race.filter((r) => r.error?.message === "Room full").length, 1, "同時参加の残りは満員で拒否");
  const guest = race[0].error ? b : a;
  const outsider = race[0].error ? a : b;
  checked(await outsider.c.rpc("create_room"), "別ルーム作成失敗");
  assert.equal(checked(await members(host), "メンバー読取失敗").length, 2, "最大2人");
  assert.deepEqual(checked(await members(outsider), "別ルーム読取リクエスト失敗"), [], "他ルームは読み取れないこと");
  assert((await outsider.c.from("rooms").select("id")).error, "招待ハッシュのテーブルは読めないこと");
  for (const p of [guest, outsider]) {
    const result = await p.c.from("room_members").update({ x: 9 }).eq("room_id", room.room_id).eq("user_id", host.id).select("user_id");
    assert.deepEqual(checked(result, "他人の更新リクエスト失敗"), [], "他人の座標を更新できないこと");
  }
  assert((await host.c.from("room_members").update({ slot: 1 }).eq("room_id", room.room_id)).error, "席の書き換え拒否");
  assert((await host.c.from("room_members").update({ moved_at: new Date().toISOString() }).eq("room_id", room.room_id)).error, "移動制限時刻の書き換え拒否");
  for (const field of ["area", "x", "z", "yaw"]) {
    assert.equal((await host.c.from("room_members").update({ [field]: null }).eq("room_id", room.room_id).eq("user_id", host.id)).error?.code, "23502", "NULL座標とエリアの拒否");
  }
  await denyPresence(outsider.c, room.room_id, outsider.id);
  const h = watch(host.c, room.room_id, host.id);
  const g = watch(guest.c, room.room_id, guest.id);
  await Promise.all([h.ready, g.ready]);
  await until(() => Object.keys(h.channel.presenceState()).length === 2, "2人のPresence同期失敗");
  async function move(p, area, x) {
    const result = await p.c.from("room_members").update({ area, x, z: 2, yaw: 0 }).eq("room_id", room.room_id).eq("user_id", p.id).select("user_id");
    assert.equal(checked(result, "座標更新失敗").length, 1, "自分の座標更新成功");
  }
  await move(host, "town", 5);
  await until(() => g.updates.some((p) => p.user_id === host.id && p.area === "town" && p.x === 5), "Home/Town別行動の配信失敗");
  await move(guest, "town", 6);
  await until(() => h.updates.some((p) => p.user_id === guest.id && p.area === "town" && p.x === 6), "逆方向の座標配信失敗");
  await move(host, "home", 1);
  await until(() => g.updates.some((p) => p.user_id === host.id && p.area === "home" && p.x === 1), "Homeへの復帰配信失敗");
  await guest.c.removeChannel(g.channel);
  await until(() => !h.channel.presenceState()[guest.id], "切断後のPresence退出失敗");
  guest.c = client(guest.storage);
  const restored = checked(await guest.c.auth.getSession(), "保存済み認証の復元失敗");
  assert.equal(restored.session?.user.id, guest.id, "新しいクライアントでも本人として復元されること");
  await guest.c.realtime.setAuth(restored.session.access_token);
  assert.equal(checked(await join(guest), "同じセッションの再入室失敗"), 1);
  assert.equal((await join(outsider)).error?.message, "Room full", "切断後も第三者に席を渡さないこと");
  const rejoined = watch(guest.c, room.room_id, guest.id);
  await rejoined.ready;
  await until(() => Boolean(h.channel.presenceState()[guest.id]), "再接続Presence同期失敗");
  await move(guest, "home", 2);
  await until(() => h.updates.some((p) => p.user_id === guest.id && p.area === "home" && p.x === 2), "再接続後の座標配信失敗");
  checked(await host.c.auth.signOut({ scope: "local" }), "端末ログアウト失敗");
  assert.equal(checked(await host.c.auth.getSession(), "ログアウト確認失敗").session, null, "ログアウトでセッションが消えること");
  assert.equal(host.storage.getItem("roomie-auth"), null, "SDKが端末の認証保存を消すこと");
  console.log("PASS: 同時作成制限・招待再発行・NULL拒否・同時参加上限・RLS・非公開Presence・双方向座標配信・再入室・端末ログアウト");
} catch (error) {
  // SDK errors may contain request details; report only our fixed check messages.
  console.error(error instanceof assert.AssertionError ? `FAIL: ${error.message.split("\n")[0]}` : "FAIL: 接続検証が完了しませんでした。Supabase設定と接続を確認してください。");
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((c) => c.removeAllChannels()));
  clients.forEach((c) => c.auth.stopAutoRefresh());
}
