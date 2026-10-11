import { useCallback, useEffect, useRef, useState } from "react";
import Game from "./game/Game";
import { spawn, type Area, type Player, type View } from "./game/world";
import {
  connectRoom,
  inviteCode,
  logoutDevice,
  MAX_INVITE_INPUT,
  onlineConfigured,
  rememberedRoom,
  type Connection,
} from "./network/room";
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1" />
      </>
    ),
    leaf: (
      <>
        <path d="M19 4C7 2 2 9 6 15s15 2 13-11Z" />
        <path d="M4 21 15 9" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17v.1" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.leaf}
    </svg>
  );
}
export default function App() {
  const player = useRef(spawn(crypto.randomUUID()));
  const connection = useRef<Connection | null>(null);
  const generation = useRef(0);
  const opening = useRef<AbortController | null>(null);
  const [area, setArea] = useState<Area>("home"),
    [view, setView] = useState<View>("overhead");
  const [peers, setPeers] = useState<Player[]>([]),
    [status, setStatus] = useState("ひとりで探索中");
  const [input, setInput] = useState(
    () =>
      inviteCode(location.href) || rememberedRoom(),
  );
  const [modal, setModal] = useState<"room" | "help" | null>(
    input ? "room" : null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [turn, setTurn] = useState(0),
    [copied, setCopied] = useState(false);
  const [fatal, setFatal] = useState("");
  const [confirmAction, setConfirmAction] = useState<"logout" | "rotate" | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const flip = useCallback(
    () => setView((v) => (v === "overhead" ? "first" : "overhead")),
    [],
  );
  useEffect(
    () => () => {
      generation.current++;
      opening.current?.abort();
      void connection.current?.close();
    },
    [],
  );
  useEffect(() => {
    const forget = (event: StorageEvent) => {
      if (event.key !== "roomie-auth" && event.key !== null) return;
      if (event.newValue !== null) return;
      void leave();
      setInput("");
      setBusy(false);
      setConfirmAction(null);
    };
    window.addEventListener("storage", forget);
    return () => window.removeEventListener("storage", forget);
  }, []);
  useEffect(() => {
    if (!modal) {
      setConfirmAction(null);
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled)",
        ) ?? [],
      );
    (
      dialog.current?.querySelector<HTMLElement>("input:not([readonly])") ??
      focusable()[0]
    )?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.code === "Escape" && !busy) setModal(null);
      if (e.code === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal, busy, code, confirmAction]);
  async function enter(join: boolean) {
    if (busy || connection.current) return;
    const attempt = ++generation.current;
    const controller = new AbortController();
    opening.current = controller;
    setBusy(true);
    setError("");
    try {
      const parsed = join ? inviteCode(input) : undefined;
      if (join && !parsed) throw new Error("招待リンクを確認してください。");
      const next = await connectRoom(
        parsed,
        player.current.id,
        {
          peers: (players) => { if (attempt === generation.current) setPeers(players); },
          status: (value) => { if (attempt === generation.current) setStatus(value); },
        },
        controller.signal,
      );
      if (attempt !== generation.current) {
        await next.close();
        return;
      }
      connection.current = next;
      player.current.slot = next.slot;
      if (
        next.slot === 1 &&
        player.current.area === "home" &&
        player.current.x === 0.7 &&
        player.current.z === 2.8
      )
        player.current.x = 1.6;
      setCode(next.code);
      setInput(next.code);
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#invite=${next.code}`,
      );
    } catch (e) {
      if (attempt !== generation.current) return;
      setError(e instanceof Error ? e.message : "接続できませんでした。");
      setStatus("未接続");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  async function leave() {
    generation.current++;
    opening.current?.abort();
    const current = connection.current;
    connection.current = null;
    setCode("");
    setPeers([]);
    setStatus("ひとりで探索中");
    history.replaceState(null, "", location.pathname + location.search);
    try {
      await current?.close();
    } catch {
      setError("接続の終了を確認できませんでした。ページを閉じてください。");
    }
  }
  async function confirm() {
    if (busy) return;
    let attempt = generation.current;
    setBusy(true);
    setError("");
    try {
      if (confirmAction === "logout") {
        await leave();
        attempt = generation.current;
        await logoutDevice();
        if (attempt !== generation.current) return;
        setInput("");
      } else if (confirmAction === "rotate" && connection.current?.rotateInvite) {
        const next = await connection.current.rotateInvite();
        if (attempt !== generation.current) return;
        setCode(next);
        setInput(next);
        setCopied(false);
        history.replaceState(null, "", `${location.pathname}${location.search}#invite=${next}`);
      }
      setConfirmAction(null);
    } catch (e) {
      if (attempt !== generation.current) return;
      setError(e instanceof Error ? e.message : "操作を完了できませんでした。");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  const invite = code
    ? `${location.origin}${location.pathname}#invite=${code}`
    : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("招待リンクを選択してコピーしてください。");
    }
  }
  const partner = peers[0],
    local = code.startsWith("local."),
    inSameArea = partner?.area === area;
  return (
    <main className="app">
      <header className="header">
        <a
          className="brand"
          href={location.pathname}
          aria-label="Roomie ホーム"
        >
          <span className="brand-mark">
            <Icon name="home" size={23} />
            <span />
          </span>
          roomie<span className="brand-dot">.</span>
        </a>
        <div className="tagline">離れていても、同じ家に帰れる。</div>
        <div className="header-actions">
          <span className="connection">
            <i className={peers.length ? "live" : ""} />
            {status}
          </span>
          <span className="header-divider" />
          <button
            className="invite-button"
            onClick={() => {
              setModal("room");
              setError("");
            }}
          >
            <Icon name="people" size={17} />
            <span>ふたりで遊ぶ</span>
            <span className="count">{code ? peers.length + 1 : 1}/2</span>
          </button>
          <button
            className="icon-button help-button"
            onClick={() => setModal("help")}
            aria-label="遊び方"
          >
            <Icon name="help" />
          </button>
        </div>
      </header>
      <section className={`world ${area}`} aria-label="ゲーム画面">
        <Game
          player={player.current}
          peers={peers}
          view={view}
          paused={Boolean(modal)}
          onArea={setArea}
          onView={flip}
          onMove={(p) => connection.current?.send(p)}
          onError={setFatal}
          turn={turn}
        />
        <div className="world-top">
          <div className="location">
            <div className="eyebrow">
              <span /> OUR LITTLE WORLD
            </div>
            <div className="location-title">
              <Icon name={area === "home" ? "home" : "leaf"} size={22} />
              <h1>{area === "home" ? "ふたりのおうち" : "こもれびの街"}</h1>
              <span className="location-tag">
                {area === "home" ? "HOME" : "TOWN"}
              </span>
            </div>
            <p>
              {area === "home"
                ? "なんでもない時間を、いっしょに。"
                : "少しだけ、ふたりでおさんぽ。"}
            </p>
          </div>
          <div className="daylight">
            <Icon name="sun" size={19} />
            <div>
              <span>A LITTLE SLOWER, A LITTLE CLOSER</span>
              <strong>今日も、のんびり。</strong>
            </div>
          </div>
        </div>
        <aside className="together">
          <div className="together-heading">
            <span>この世界にいるひと</span>
            <span>{peers.length + 1} / 2</span>
          </div>
          <div className="resident">
            <span className={`avatar-icon player-${player.current.slot}`}>
              ●
            </span>
            <div>
              <strong>あなた</strong>
              <small>
                {area === "home" ? "おうちで過ごしています" : "街をおさんぽ中"}
              </small>
            </div>
            <i className="resident-live" />
          </div>
          <div className={`resident ${partner ? "" : "waiting"}`}>
            <span
              className={`avatar-icon ${partner ? `player-${1 - player.current.slot}` : "empty-avatar"}`}
            >
              {partner ? "●" : "+"}
            </span>
            <div>
              <strong>{partner ? "パートナー" : "もうひとりの居場所"}</strong>
              <small>
                {partner
                  ? inSameArea
                    ? "同じ場所にいます"
                    : partner.area === "home"
                      ? "おうちで過ごしています"
                      : "街をおさんぽ中"
                  : "招待して、いっしょに過ごそう"}
              </small>
            </div>
          </div>
          {!partner && (
            <button className="text-button" onClick={() => setModal("room")}>
              招待ルームをひらく <Icon name="arrow" size={15} />
            </button>
          )}
        </aside>
        {fatal && (
          <div className="fatal" role="alert">
            {fatal}
          </div>
        )}
        <div className="world-bottom">
          <div className="place-note">
            <span className="note-icon">
              <Icon name="leaf" size={19} />
            </span>
            <div>
              <strong>
                {area === "home"
                  ? "おかえり、いつもの場所へ。"
                  : "目的のない、おさんぽもいいね。"}
              </strong>
              <span>
                {area === "home"
                  ? "手前の緑の玄関マットから、街へ出られます。"
                  : "緑の屋根のおうちに、いつでも帰れます。"}
              </span>
            </div>
          </div>
          <div className="view-controls">
            <div className="view-caption">
              視点をかえてみよう <kbd>V</kbd>
            </div>
            <div className="view-switch" role="group" aria-label="カメラ視点">
              <button
                className={view === "overhead" ? "selected" : ""}
                onClick={() => setView("overhead")}
                aria-pressed={view === "overhead"}
              >
                <Icon name="grid" size={16} />
                見下ろし
              </button>
              <button
                className={view === "first" ? "selected" : ""}
                onClick={() => setView("first")}
                aria-pressed={view === "first"}
              >
                <Icon name="eye" size={18} />
                アバター目線
              </button>
            </div>
            {view === "first" && (
              <div className="turn-controls">
                <button onClick={() => setTurn((t) => t + 1)}>
                  ← 左を向く <kbd>Q</kbd>
                </button>
                <button onClick={() => setTurn((t) => t - 1)}>
                  右を向く → <kbd>E</kbd>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="scene-caption">
          {area === "home" ? "01 — OUR HOME" : "02 — KOMOREBI TOWN"}
          <span>小さな世界、大切な日常。</span>
        </div>
      </section>
      <footer className="footer">
        <div className="movement-hint">
          <span className="key-group">
            {["W", "A", "S", "D"].map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
          <span>歩く</span>
          <span className="footer-dot">·</span>
          <kbd>V</kbd>
          <span>視点を切り替える</span>
          <span className="footer-dot">·</span>
          <span>玄関でおうちと街を行き来</span>
        </div>
        <span className="footer-label">
          <Icon name="leaf" size={13} /> MADE FOR TWO
        </span>
      </footer>
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            ref={dialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              disabled={busy}
              onClick={() => setModal(null)}
              aria-label="閉じる"
            >
              <Icon name="close" />
            </button>
            <span className="modal-emblem">
              <Icon name={modal === "room" ? "people" : "home"} size={28} />
            </span>
            <div className="eyebrow">A PLACE FOR THE TWO OF YOU</div>
            <h2 id="modal-title">
              {modal === "room"
                ? confirmAction === "logout"
                  ? "この端末からログアウトしますか？"
                  : confirmAction === "rotate"
                    ? "招待リンクを再発行しますか？"
                    : "いつもの場所に、招待しよう。"
                : "ふたりの世界の歩き方。"}
            </h2>
            {modal === "help" ? (
              <>
                <p>
                  急ぐことも、クリアすることもありません。
                  <br />
                  同じおうちと街で、気ままに過ごしましょう。
                </p>
                <dl className="help-list">
                  <div>
                    <dt>W A S D / 矢印キー</dt>
                    <dd>アバターを動かす</dd>
                  </div>
                  <div>
                    <dt>V</dt>
                    <dd>見下ろし ↔ アバター目線</dd>
                  </div>
                  <div>
                    <dt>Q / E</dt>
                    <dd>90度、左 / 右を向く</dd>
                  </div>
                  <div>
                    <dt>緑の玄関マット</dt>
                    <dd>手前へ歩くと街へ。自宅の扉へ歩くと帰宅。</dd>
                  </div>
                </dl>
                <button
                  className="primary-button"
                  onClick={() => setModal(null)}
                >
                  おうちで過ごす <Icon name="arrow" size={17} />
                </button>
              </>
            ) : (
              <>
                {!confirmAction && <p>
                  {code
                    ? "この招待リンクを、もうひとりに。"
                    : "ふたりだけのルームを作るか、届いた招待で参加できます。"}
                </p>}
                <div className="mode-note">
                  <span className="mode-badge">
                    {local || !onlineConfigured
                      ? "LOCAL PREVIEW"
                      : "PRIVATE ONLINE"}
                  </span>
                  <span>
                    {local || !onlineConfigured
                      ? "ローカル検証：同じブラウザの別タブ専用です。遠隔通信にはSupabaseの設定が必要です。"
                      : "Supabaseで接続します。招待リンクはパートナーだけに共有してください。"}
                  </span>
                </div>
                {confirmAction ? (
                  <>
                    <p>
                      {confirmAction === "logout"
                        ? "この端末の認証と記憶した招待を消します。匿名ユーザーは復元できず、同じルームの本人の席にも戻れなくなります。同じブラウザの他のタブにも影響します。"
                        : "古い招待リンクを無効にして、新しいリンクを作ります。参加済みの相手の席は残りますが、次の再入室には新しいリンクが必要です。"}
                    </p>
                    <button className="primary-button" disabled={busy} onClick={() => void confirm()}>
                      {busy ? "処理しています…" : confirmAction === "logout" ? "ログアウトする（復元できません）" : "新しい招待リンクを発行する"}
                    </button>
                    <button className="secondary-button" disabled={busy} onClick={() => setConfirmAction(null)}>
                      キャンセル
                    </button>
                  </>
                ) : code ? (
                  <>
                    <label className="field-label" htmlFor="invite-out">
                      招待リンク
                    </label>
                    <div className="invite-output">
                      <input
                        id="invite-out"
                        value={invite}
                        readOnly
                        onFocus={(e) => e.target.select()}
                      />
                      <button aria-label="招待リンクをコピー" disabled={busy} onClick={copy}>
                        <Icon name="copy" size={18} />
                      </button>
                    </div>
                    <div className="copy-state" role="status">
                      {copied
                        ? "コピーしました。"
                        : local
                          ? "リンクを同じブラウザの別タブで開いてください。"
                          : "参加できるのは2人まで。同じブラウザで、次回もこのルームに戻れます。"}
                    </div>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => setModal(null)}
                    >
                      世界にもどる <Icon name="arrow" size={17} />
                    </button>
                    {connection.current?.rotateInvite && (
                      <button className="secondary-button" disabled={busy} onClick={() => { setError(""); setConfirmAction("rotate"); }}>
                        招待リンクを再発行する
                      </button>
                    )}
                    <button
                      className="leave-button"
                      disabled={busy}
                      onClick={() => void leave()}
                    >
                      ルームから退出する
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void enter(false)}
                    >
                      <Icon name="home" size={18} />
                      {busy ? "接続しています…" : "ふたりのルームをつくる"}
                      <Icon name="arrow" size={17} />
                    </button>
                    <div className="or-divider">
                      <span>招待をもらったら</span>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void enter(true);
                      }}
                    >
                      <label className="field-label" htmlFor="invite-input">
                        招待リンク / コード
                      </label>
                      <input
                        id="invite-input"
                        autoFocus
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="ここに招待リンクを貼り付け"
                        autoComplete="off"
                        required
                        maxLength={MAX_INVITE_INPUT}
                      />
                      <button
                        className="secondary-button"
                        disabled={busy || !input.trim()}
                        type="submit"
                      >
                        ルームに参加する <Icon name="arrow" size={16} />
                      </button>
                    </form>
                  </>
                )}
                {onlineConfigured && !local && !confirmAction && (
                  <button className="leave-button" disabled={busy} onClick={() => { setError(""); setConfirmAction("logout"); }}>
                    この端末からログアウト
                  </button>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
