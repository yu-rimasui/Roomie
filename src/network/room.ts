import { createClient } from "@supabase/supabase-js";
import { spawn, validPlayer, type Player } from "../game/world";
export type Connection = {
  code: string;
  slot: number;
  mode: "local" | "online";
  send: (p: Player) => void;
  close: () => Promise<void>;
};
export type RoomEvents = {
  peers: (players: Player[]) => void;
  status: (status: string) => void;
};
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const onlineConfigured = Boolean(url && key);
export function rememberedRoom() {
  if (!onlineConfigured) return "";
  try {
    return localStorage.getItem("roomie-last-room") || "";
  } catch {
    return "";
  }
}
export function inviteCode(input: string) {
  try {
    if (input.includes("://"))
      return (
        new URLSearchParams(new URL(input).hash.slice(1)).get("invite") || ""
      );
  } catch {
    return "";
  }
  return input.trim();
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
type LocalMember = { player: Player; seen: number };
export function liveMembers(members: unknown, now: number): LocalMember[] {
  if (!Array.isArray(members)) return [];
  return members.filter(
    (m) =>
      m &&
      typeof m === "object" &&
      validPlayer(m.player) &&
      Number.isFinite(m.seen) &&
      now >= m.seen &&
      now - m.seen < 8000,
  );
}
async function localRoom(
  code: string | undefined,
  id: string,
  events: RoomEvents,
): Promise<Connection> {
  if (!navigator.locks || !("BroadcastChannel" in window))
    throw new Error(
      "ローカル通信には対応ブラウザの localhost または HTTPS が必要です。",
    );
  const roomCode = code || `local.${randomToken()}`;
  if (!/^local\.[a-f0-9]{48}$/.test(roomCode))
    throw new Error("招待リンクを確認してください。");
  const storageKey = `roomie:${roomCode}`;
  let state: Player = spawn(id),
    closed = false;
  async function edit(fn: (members: LocalMember[]) => LocalMember[]) {
    return navigator.locks.request(storageKey, () => {
      const raw = localStorage.getItem(storageKey);
      if (code && !raw)
        throw new Error(
          "このローカルルームが見つかりません。同じブラウザで開いてください。",
        );
      const members = liveMembers(raw ? JSON.parse(raw) : [], Date.now());
      const next = fn(members);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }
  const members = await edit((ms) => {
    if (ms.length >= 2) throw new Error("このルームは2人で満員です。");
    state = spawn(id, ms.some((m) => m.player.slot === 0) ? 1 : 0);
    return [...ms, { player: state, seen: Date.now() }];
  });
  const channel = new BroadcastChannel(storageKey);
  function receive(ms: LocalMember[]) {
    events.peers(
      ms
        .filter((m) => m.player.id !== id && validPlayer(m.player))
        .map((m) => m.player),
    );
  }
  async function pulse() {
    if (closed) return;
    try {
      const ms = await edit((ms) => {
        if (!ms.some((m) => m.player.id === id))
          throw new Error("接続が期限切れです。ルームに入り直してください。");
        return ms.map((m) =>
          m.player.id === id ? { player: state, seen: Date.now() } : m,
        );
      });
      if (closed) return;
      receive(ms);
      channel.postMessage(ms);
    } catch (e) {
      if (closed) return;
      events.status(e instanceof Error ? e.message : "ローカル通信エラー");
      events.peers([]);
    }
  }
  channel.onmessage = () => {
    void pulseRead();
  };
  function pulseRead() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw && !closed) receive(liveMembers(JSON.parse(raw), Date.now()));
    } catch {
      events.status("ローカル通信エラー");
      events.peers([]);
    }
  }
  receive(members);
  events.status("ローカル接続");
  channel.postMessage(members);
  const heartbeat = window.setInterval(() => void pulse(), 1000);
  let last = 0;
  return {
    code: roomCode,
    slot: state.slot,
    mode: "local",
    send: (p) => {
      state = { ...p, slot: state.slot, id };
      if (performance.now() - last > 90) {
        last = performance.now();
        void pulse();
      }
    },
    close: async () => {
      closed = true;
      clearInterval(heartbeat);
      await edit((ms) => ms.filter((m) => m.player.id !== id)).catch(() => {});
      channel.postMessage([]);
      channel.close();
      events.peers([]);
    },
  };
}
function rowPlayer(row: Record<string, unknown>): Player {
  return {
    id: row.user_id as string,
    slot: row.slot as number,
    area: row.area as Player["area"],
    x: row.x as number,
    z: row.z as number,
    yaw: row.yaw as number,
  };
}
async function onlineRoom(
  code: string | undefined,
  events: RoomEvents,
): Promise<Connection> {
  if (
    code &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{48}$/.test(code)
  )
    throw new Error("オンライン用の招待リンクを確認してください。");
  const client = createClient(url, key, {
    auth: {
      storage: localStorage,
      storageKey: "roomie-auth",
      detectSessionInUrl: false,
    },
  });
  let closed = false;
  try {
    const { data: existing, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error("認証セッションを確認できませんでした。");
    let session = existing.session;
    if (!session) {
      const result = await client.auth.signInAnonymously();
      if (result.error)
        throw new Error(
          "匿名認証に失敗しました。Supabase設定を確認してください。",
        );
      session = result.data.session;
    }
    if (!session) throw new Error("認証セッションを作成できませんでした。");
    let roomId: string, slot: number, roomCode: string;
    if (code) {
      const [rid, token] = code.split(".");
      const { data, error } = await client.rpc("join_room", {
        target_room: rid,
        invite_token: token,
      });
      if (error)
        throw new Error("参加できません。招待が無効、またはルームが満員です。");
      roomId = rid;
      slot = data;
      roomCode = code;
    } else {
      const { data, error } = await client.rpc("create_room");
      if (error)
        throw new Error("ルームを作成できません。SQLの適用を確認してください。");
      roomId = data.room_id;
      slot = 0;
      roomCode = `${roomId}.${data.invite_token}`;
    }
    const id = session.user.id;
    await client.realtime.setAuth(session.access_token);
    let connected = false,
      subscription = 0,
      active = new Set<string>(),
      roster: Player[] = [];
    const emit = () =>
      events.peers(
        connected ? roster.filter((p) => p.id !== id && active.has(p.id)) : [],
      );
    async function refresh() {
      const { data, error } = await client
        .from("room_members")
        .select("user_id,slot,area,x,z,yaw")
        .eq("room_id", roomId);
      if (closed || !connected) return;
      if (error) {
        events.status("同期エラー");
        return;
      }
      roster = (data ?? []).map(rowPlayer).filter(validPlayer);
      emit();
    }
    const channel = client
      .channel(`room:${roomId}`, {
        config: { private: true, presence: { key: id } },
      })
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        ({ new: row }) => {
          if (closed) return;
          const player = rowPlayer(row);
          if (!validPlayer(player)) return;
          roster = roster.filter((p) => p.id !== player.id);
          roster.push(player);
          emit();
        },
      )
      .on("presence", { event: "sync" }, () => {
        if (closed) return;
        active = new Set(Object.keys(channel.presenceState()));
        emit();
        void refresh();
      });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("接続がタイムアウトしました。")),
        12000,
      );
      channel.subscribe(async (status) => {
        if (closed) return;
        const attempt = ++subscription;
        if (status === "SUBSCRIBED") {
          const result = await channel.track({ online: true }).catch(() => "error");
          if (closed || attempt !== subscription) return;
          if (result !== "ok") {
            connected = false;
            events.status("在室情報の送信エラー・再入室してください");
            events.peers([]);
            clearTimeout(timeout);
            reject(new Error("在室情報を送信できません。"));
            return;
          }
          connected = true;
          events.status("オンライン");
          void refresh();
          clearTimeout(timeout);
          resolve();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          connected = false;
          active.clear();
          events.status("切断・再接続中");
          events.peers([]);
          clearTimeout(timeout);
          reject(
            new Error("Realtimeに接続できません。権限設定を確認してください。"),
          );
        }
      });
    });
    let last = 0,
      pending = false,
      lastSent = "";
    try {
      localStorage.setItem("roomie-last-room", roomCode);
    } catch {
      throw new Error("再入室に必要な保存ができません。ブラウザの保存設定を確認してください。");
    }
    return {
      code: roomCode,
      slot,
      mode: "online",
      send: (p) => {
        const signature = `${p.area}:${p.x}:${p.z}:${p.yaw}`;
        if (
          pending ||
          signature === lastSent ||
          performance.now() - last < 100 ||
          closed
        )
          return;
        last = performance.now();
        pending = true;
        void Promise.resolve(
          client
            .from("room_members")
            .update({ area: p.area, x: p.x, z: p.z, yaw: p.yaw })
            .eq("room_id", roomId)
            .eq("user_id", id),
        )
          .then(
            ({ error }) => {
              if (closed) return;
              if (error) {
                if (connected) events.status("位置同期エラー");
              } else {
                lastSent = signature;
                if (connected) events.status("オンライン");
              }
            },
            () => {
              if (!closed && connected) events.status("位置同期エラー");
            },
          )
          .finally(() => {
            pending = false;
          });
      },
      close: async () => {
        if (closed) return;
        closed = true;
        events.peers([]);
        try {
          await client.removeChannel(channel);
        } finally {
          client.auth.stopAutoRefresh();
        }
      },
    };
  } catch (error) {
    closed = true;
    try {
      await client.removeAllChannels();
    } finally {
      client.auth.stopAutoRefresh();
    }
    throw error;
  }
}
export async function connectRoom(
  code: string | undefined,
  id: string,
  events: RoomEvents,
) {
  if (code?.startsWith("local.") || !onlineConfigured)
    return localRoom(code, id, events);
  return onlineRoom(code, events);
}
