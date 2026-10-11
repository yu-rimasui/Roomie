import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import schema from "../supabase/schema.sql?raw";
import migration from "../supabase/migrations/001_fix_invite_validation.sql?raw";
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
  vi.stubGlobal("localStorage", { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() });
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
