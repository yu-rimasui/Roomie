import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import schema from "../supabase/schema.sql?raw";
import migration from "../supabase/migrations/001_fix_invite_validation.sql?raw";
import safetyMigration from "../supabase/migrations/002_room_safety.sql?raw";
import { spawn } from "../src/game/world";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
const roomId = "11111111-1111-1111-1111-111111111111";
const code = `${roomId}.${"a".repeat(48)}`;
const peer = { user_id: "peer", ...spawn("peer", 1) };

function server(automaticDatabaseReady = true) {
  let subscribed: (status: string) => Promise<void>;
  const handlers = new Map<string, (payload?: any) => void>();
  const status = async (s: string) => {
    await subscribed(s);
    if (s === "SUBSCRIBED" && automaticDatabaseReady)
      handlers.get("system")?.({ extension: "postgres_changes", status: "ok" });
  };
  const write = vi.fn().mockResolvedValue({ error: null });
  const rows = vi.fn().mockResolvedValue({ data: [peer], error: null });
  const update = {
    eq: vi.fn(() => update),
    then: (resolve: any, reject: any) => write().then(resolve, reject),
  };
  const channel = {
    on: vi.fn((event, _filter, callback) => {
      handlers.set(event, callback);
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      subscribed = callback;
      queueMicrotask(() => void status("SUBSCRIBED"));
      return channel;
    }),
    track: vi.fn().mockResolvedValue("ok"),
    presenceState: vi.fn(() => ({ peer: [{}] })),
  };
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "self" }, access_token: "test" } }, error: null }),
      signInAnonymously: vi.fn(),
      stopAutoRefresh: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    realtime: { setAuth: vi.fn() },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn().mockResolvedValue("ok"),
    removeAllChannels: vi.fn().mockResolvedValue([]),
    from: vi.fn(() => ({ select: () => ({ eq: rows }), update: () => update })),
  };
  createClient.mockReturnValue(client);
  return { client, channel, handlers, rows, write, status };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  vi.stubGlobal("localStorage", { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function connect() {
  const { connectRoom } = await import("../src/network/room");
  const events = { peers: vi.fn(), status: vi.fn() };
  return { events, opening: connectRoom(code, "self", events) };
}

describe("online connection", () => {
  it("does not start authentication or RPCs for a cancelled join", async () => {
    const s = server();
    const { connectRoom } = await import("../src/network/room");
    const controller = new AbortController();
    const opening = connectRoom(code, "self", { peers: vi.fn(), status: vi.fn() }, controller.signal);
    controller.abort();
    await expect(opening).rejects.toThrow();
    expect(s.client.rpc).not.toHaveBeenCalled();
    createClient.mockClear();
    await expect(connectRoom(code, "self", { peers: vi.fn(), status: vi.fn() }, controller.signal)).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("cancels a pending realtime join without restoring the remembered invite", async () => {
    const s = server(false);
    const { connectRoom } = await import("../src/network/room");
    const controller = new AbortController();
    const events = { peers: vi.fn(), status: vi.fn() };
    const opening = connectRoom(code, "self", events, controller.signal);
    const rejected = expect(opening).rejects.toThrow("キャンセル");
    await vi.waitFor(() => expect(s.channel.track).toHaveBeenCalled());
    controller.abort();
    s.handlers.get("system")!({ extension: "postgres_changes", status: "ok" });
    await rejected;
    s.handlers.get("system")!({ extension: "postgres_changes", status: "ok" });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(events.status).not.toHaveBeenCalledWith("オンライン");
    expect(s.client.removeAllChannels).toHaveBeenCalledOnce();
  });

  it("waits for database replication readiness before marking the room online", async () => {
    const s = server(false);
    const { opening, events } = await connect();
    await vi.waitFor(() => expect(s.channel.track).toHaveBeenCalled());
    s.handlers.get("system")!({ extension: "system", status: "ok" });
    expect(events.status).not.toHaveBeenCalledWith("オンライン");
    s.handlers.get("system")!({ extension: "postgres_changes", status: "ok" });
    const connection = await opening;
    expect(events.status).toHaveBeenLastCalledWith("オンライン");
    await connection.close();
  });

  it("cleans up when database replication cannot start", async () => {
    const s = server(false);
    const { opening } = await connect();
    const rejected = expect(opening).rejects.toThrow("位置配信");
    await vi.waitFor(() => expect(s.channel.track).toHaveBeenCalled());
    s.handlers.get("system")!({ extension: "postgres_changes", status: "error" });
    await rejected;
    expect(s.client.removeAllChannels).toHaveBeenCalledOnce();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("keeps the browser identity and remembers the room only after connecting", async () => {
    const s = server();
    const { opening } = await connect();
    const connection = await opening;
    expect(createClient.mock.calls[0][2].auth.storage).toBe(localStorage);
    expect(s.client.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith("roomie-last-room", code);
    const { rememberedRoom } = await import("../src/network/room");
    vi.mocked(localStorage.getItem).mockReturnValue(code);
    expect(rememberedRoom()).toBe(code);
    await connection.close();
    expect(rememberedRoom()).toBe(code);
  });

  it("handles disabled browser storage without crashing the initial screen", async () => {
    const { rememberedRoom } = await import("../src/network/room");
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error("blocked"); });
    expect(rememberedRoom()).toBe("");
    const s = server();
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("full"); });
    const { opening } = await connect();
    await expect(opening).rejects.toThrow("保存ができません");
    expect(s.client.removeAllChannels).toHaveBeenCalledOnce();
  });

  it("rejects malformed invites before creating an auth client", async () => {
    const { connectRoom } = await import("../src/network/room");
    await expect(connectRoom(`${"-".repeat(36)}.${"a".repeat(48)}`, "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow("招待");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("never creates a room for an empty or oversized join input", async () => {
    const { connectRoom, inviteCode } = await import("../src/network/room");
    for (const input of ["", "   ", "https://example.test/without-invite", "x".repeat(10 * 1024 * 1024)]) {
      await expect(connectRoom(inviteCode(input), "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow("招待");
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects empty joins in local mode too", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const { connectRoom } = await import("../src/network/room");
    await expect(connectRoom("", "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow("招待");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a room only when explicitly requested with undefined", async () => {
    const s = server();
    s.client.rpc.mockResolvedValue({ data: { room_id: roomId, invite_token: "a".repeat(48) }, error: null });
    const { connectRoom } = await import("../src/network/room");
    const connection = await connectRoom(undefined, "self", { peers: vi.fn(), status: vi.fn() });
    expect(s.client.rpc).toHaveBeenCalledWith("create_room");
    expect(connection.code).toBe(code);
    await connection.close();
  });

  it.each([["PT429", "60秒"], ["PT409", "3つ"], ["PT503", "受付上限"]])("explains server creation limits (%s)", async (errorCode, message) => {
    const s = server();
    s.client.rpc.mockResolvedValue({ data: null, error: { code: errorCode } });
    const { connectRoom } = await import("../src/network/room");
    await expect(connectRoom(undefined, "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow(message);
    expect(s.client.channel).not.toHaveBeenCalled();
    expect(s.client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  });

  it("rejects malformed RPC success data and closes the auth client", async () => {
    const s = server();
    const { connectRoom } = await import("../src/network/room");
    for (const data of [null, [], {}, "bad", 2]) {
      s.client.rpc.mockResolvedValue({ data, error: null });
      await expect(connectRoom(code, "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow("参加結果");
      await expect(connectRoom(undefined, "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow("作成結果");
    }
    expect(s.client.channel).not.toHaveBeenCalled();
  });

  it("ignores null and malformed Realtime rows", async () => {
    const s = server();
    const { opening, events } = await connect();
    const connection = await opening;
    events.peers.mockClear();
    for (const row of [null, undefined, [], "bad", { ...peer, x: "1" }, { ...peer, x: 1e300 }]) {
      expect(() => s.handlers.get("postgres_changes")!({ new: row })).not.toThrow();
    }
    expect(events.peers).not.toHaveBeenCalled();
    await connection.close();
  });

  it("filters null fetched rows and catches rejected refreshes", async () => {
    const s = server();
    s.rows.mockResolvedValue({ data: [null, peer], error: null });
    const { opening, events } = await connect();
    const connection = await opening;
    s.handlers.get("presence")!();
    await vi.waitFor(() => expect(events.peers).toHaveBeenLastCalledWith([spawn("peer", 1)]));
    for (const data of [null, {}, "bad"]) {
      events.status.mockClear();
      s.rows.mockResolvedValue({ data, error: null });
      s.handlers.get("presence")!();
      await vi.waitFor(() => expect(events.status).toHaveBeenLastCalledWith("同期エラー"));
    }
    s.rows.mockRejectedValue(new Error("transport failed"));
    events.status.mockClear();
    s.handlers.get("presence")!();
    await vi.waitFor(() => expect(events.status).toHaveBeenLastCalledWith("同期エラー"));
    await connection.close();
  });

  it("rotates the owner's invite and remembers the replacement", async () => {
    const s = server();
    s.client.rpc.mockResolvedValueOnce({ data: 0, error: null });
    const { opening } = await connect();
    const connection = await opening;
    const replacement = `${roomId}.${"b".repeat(48)}`;
    s.client.rpc.mockResolvedValueOnce({ data: "b".repeat(48), error: null });
    expect(await connection.rotateInvite!()).toBe(replacement);
    expect(connection.code).toBe(replacement);
    expect(localStorage.setItem).toHaveBeenLastCalledWith("roomie-last-room", replacement);
    expect(s.client.rpc).toHaveBeenLastCalledWith("rotate_invite", { target_room: roomId });
    await connection.close();
    await expect(connection.rotateInvite!()).rejects.toThrow("入り直して");
  });

  it("keeps the old invite on rotation errors and hides rotation from guests", async () => {
    const s = server();
    s.client.rpc.mockResolvedValueOnce({ data: 0, error: null });
    const { opening } = await connect();
    const connection = await opening;
    for (const data of [null, {}, "bad"]) {
      s.client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(connection.rotateInvite!()).rejects.toThrow("再発行できません");
      expect(connection.code).toBe(code);
    }
    s.client.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT429" } });
    await expect(connection.rotateInvite!()).rejects.toThrow("10秒");
    s.client.rpc.mockRejectedValueOnce(new Error("transport detail"));
    await expect(connection.rotateInvite!()).rejects.toThrow("接続を確認");
    await connection.close();
    const guest = await (await connect()).opening;
    expect(guest.rotateInvite).toBeUndefined();
    await guest.close();
  });

  it("still returns the new invite if browser storage fails after rotation", async () => {
    const s = server();
    s.client.rpc.mockResolvedValueOnce({ data: 0, error: null });
    const { opening, events } = await connect();
    const connection = await opening;
    s.client.rpc.mockResolvedValueOnce({ data: "b".repeat(48), error: null });
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("full"); });
    expect(await connection.rotateInvite!()).toBe(`${roomId}.${"b".repeat(48)}`);
    expect(events.status).toHaveBeenLastCalledWith("新しい招待の保存エラー・リンクを控えてください");
    await connection.close();
  });

  it("signs out only this session and forgets the remembered invite", async () => {
    const s = server();
    const { logoutDevice } = await import("../src/network/room");
    await logoutDevice();
    expect(s.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.removeItem).toHaveBeenCalledWith("roomie-last-room");
    expect(s.client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  });

  it("reports failed logout without claiming the browser was cleared", async () => {
    const s = server();
    s.client.auth.signOut.mockResolvedValueOnce({ error: {} });
    const { logoutDevice } = await import("../src/network/room");
    await expect(logoutDevice()).rejects.toThrow("ログアウトを完了できません");
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(s.client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  });

  it("clears persisted auth with the real SDK against a fake Auth HTTP response", async () => {
    const sdk = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    const saved = new Map<string, string>([["roomie-last-room", code], ["unrelated", "keep"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const endpoint = String(input);
      if (endpoint.endsWith("/signup")) return new Response(JSON.stringify({
        access_token: "mock-access-token", refresh_token: "mock-refresh-token", token_type: "bearer", expires_in: 3600,
        user: { id: "self", aud: "authenticated", role: "authenticated", is_anonymous: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (endpoint.endsWith("/logout?scope=local")) return new Response(null, { status: 204 });
      throw new Error("Unexpected fake Auth endpoint");
    });
    vi.stubGlobal("fetch", mockFetch);
    const clients: ReturnType<typeof sdk.createClient>[] = [];
    createClient.mockImplementation((...args: Parameters<typeof sdk.createClient>) => {
      const client = sdk.createClient(...args);
      clients.push(client);
      return client;
    });
    const { connectRoom, logoutDevice } = await import("../src/network/room");
    // Create only a fake Auth session; the fake HTTP service rejects every database call.
    await expect(connectRoom(undefined, "self", { peers: vi.fn(), status: vi.fn() })).rejects.toThrow();
    expect(saved.has("roomie-auth")).toBe(true);
    try {
      await logoutDevice();
      expect(saved.has("roomie-auth")).toBe(false);
      expect(saved.has("roomie-last-room")).toBe(false);
      expect(saved.get("unrelated")).toBe("keep");
      expect(mockFetch.mock.calls.some(([endpoint]) => String(endpoint).endsWith("/logout?scope=local"))).toBe(true);
    } finally {
      clients.forEach((client) => client.auth.stopAutoRefresh());
    }
  });

  it("rejects huge outgoing coordinates before writing", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const s = server();
    const { opening } = await connect();
    const connection = await opening;
    connection.send({ ...spawn("self"), x: 1e300 });
    expect(s.client.from).toHaveBeenCalledTimes(1); // Initial roster fetch only.
    expect(s.write).not.toHaveBeenCalled();
    await connection.close();
    vi.mocked(performance.now).mockRestore();
  });

  it("cleans up an RPC failure without falling back to local mode", async () => {
    const s = server();
    s.client.rpc.mockResolvedValue({ data: null, error: {} });
    const { opening } = await connect();
    await expect(opening).rejects.toThrow("参加できません");
    expect(s.client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
    expect(s.client.removeAllChannels).toHaveBeenCalledOnce();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("uses private presence and delivers the partner's area and coordinates", async () => {
    const s = server();
    const { opening, events } = await connect();
    const connection = await opening;
    expect(s.client.channel).toHaveBeenCalledWith(`room:${roomId}`, { config: { private: true, presence: { key: "self" } } });
    s.handlers.get("presence")!();
    await vi.waitFor(() => expect(events.peers).toHaveBeenLastCalledWith([spawn("peer", 1)]));
    s.handlers.get("postgres_changes")!({ new: { ...peer, area: "town", x: 5 } });
    expect(events.peers).toHaveBeenLastCalledWith([{ ...spawn("peer", 1), area: "town", x: 5 }]);
    await connection.close();
  });

  it("clears disconnected peers and restores them after resubscription", async () => {
    const s = server();
    const { opening, events } = await connect();
    const connection = await opening;
    s.handlers.get("presence")!();
    await s.status("CHANNEL_ERROR");
    expect(events.peers).toHaveBeenLastCalledWith([]);
    await s.status("SUBSCRIBED");
    s.handlers.get("presence")!();
    await vi.waitFor(() => expect(events.peers).toHaveBeenLastCalledWith([spawn("peer", 1)]));
    expect(events.status).toHaveBeenLastCalledWith("オンライン");
    await connection.close();
  });

  it("does not mark a disconnected in-flight presence request as online", async () => {
    const s = server();
    let finish!: (result: string) => void;
    s.channel.track.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { opening, events } = await connect();
    const rejected = expect(opening).rejects.toThrow("Realtime");
    await vi.waitFor(() => expect(s.channel.track).toHaveBeenCalled());
    await s.status("CHANNEL_ERROR");
    finish("ok");
    await rejected;
    expect(events.status).not.toHaveBeenCalledWith("オンライン");
    expect(s.client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  });

  it("cleans up a rejected presence request", async () => {
    const s = server();
    s.channel.track.mockRejectedValue(new Error("transport failed"));
    const { opening } = await connect();
    await expect(opening).rejects.toThrow("在室情報");
    expect(s.client.removeAllChannels).toHaveBeenCalledOnce();
  });

  it("retries failed position writes and recovers the displayed status", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const s = server();
    s.write.mockRejectedValueOnce(new Error("offline"));
    const { opening, events } = await connect();
    const connection = await opening;
    connection.send(spawn("self"));
    await vi.waitFor(() => expect(events.status).toHaveBeenLastCalledWith("位置同期エラー"));
    vi.mocked(performance.now).mockReturnValue(1200);
    connection.send(spawn("self"));
    await vi.waitFor(() => expect(events.status).toHaveBeenLastCalledWith("オンライン"));
    expect(s.write).toHaveBeenCalledTimes(2);
    await connection.close();
    vi.mocked(performance.now).mockRestore();
  });

  it("ignores late events after closing and closes only once", async () => {
    const s = server();
    const { opening, events } = await connect();
    const connection = await opening;
    await connection.close();
    events.peers.mockClear();
    s.handlers.get("presence")!();
    s.handlers.get("postgres_changes")!({ new: peer });
    await s.status("SUBSCRIBED");
    await connection.close();
    expect(events.peers).not.toHaveBeenCalled();
    expect(s.client.removeChannel).toHaveBeenCalledOnce();
  });
});

it("keeps the existing-database invite fix identical to the fresh schema", () => {
  const body = (sql: string) => sql.match(/function public\.join_room[\s\S]*?\$\$;/)![0];
  expect(body(migration)).toBe(body(schema));
});

it("keeps the safety migration functions identical to the fresh schema", () => {
  for (const name of ["create_room", "rotate_invite", "limit_room_movement"]) {
    const body = (sql: string) => sql.match(new RegExp(`function public\\.${name}[\\s\\S]*?\\$\\$;`))![0];
    expect(body(safetyMigration)).toBe(body(schema));
  }
});
