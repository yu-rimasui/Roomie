async (page) => {
  for (const other of page.context().pages())
    if (other !== page) await other.close();
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const instrument = () => {
    const Original = window.BroadcastChannel;
    window.__roomieReceived = [];
    window.BroadcastChannel = class extends Original {
      constructor(name) {
        super(name);
        this.addEventListener("message", (event) =>
          window.__roomieReceived.push(event.data),
        );
      }
    };
  };
  await page.addInitScript(instrument);
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "ふたりで遊ぶ 1/2" }).click();
  await page.getByRole("button", { name: "ふたりのルームをつくる" }).click();
  const invite = await page
    .getByLabel("招待リンク", { exact: true })
    .inputValue();
  const code = new URLSearchParams(new URL(invite).hash.slice(1)).get("invite");
  const storageKey = "roomie:" + code;
  await page.getByRole("button", { name: "世界にもどる" }).click();
  const context = page.context();
  const second = await context.newPage();
  await second.addInitScript(instrument);
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto(invite);
  await second
    .getByRole("button", { name: "ルームに参加する", exact: true })
    .click();
  await second.getByRole("button", { name: "世界にもどる" }).click();
  await page.getByRole("button", { name: "ふたりで遊ぶ 2/2" }).waitFor();
  await second.getByRole("button", { name: "ふたりで遊ぶ 2/2" }).waitFor();
  const state = async () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const initial = await state();
  assert(initial.length === 2, "two clients must occupy two slots");
  const host = initial.find((m) => m.player.slot === 0).player.id;
  const guest = initial.find((m) => m.player.slot === 1).player.id;
  async function walk(tab, key, ms) {
    await tab.bringToFront();
    await tab.keyboard.down(key);
    await tab.waitForTimeout(ms);
    await tab.keyboard.up(key);
    await tab.waitForTimeout(220);
  }
  const before = initial.find((m) => m.player.id === host).player;
  await walk(page, "d", 320);
  const moved = (await state()).find((m) => m.player.id === host).player;
  assert(moved.x > before.x + 0.3, "host must move");
  await second.waitForTimeout(200);
  assert(
    await second.evaluate(
      ({ host, x }) =>
        window.__roomieReceived.some(
          (ms) =>
            Array.isArray(ms) &&
            ms.some((m) => m.player.id === host && m.player.x >= x - 0.05),
        ),
      { host, x: moved.x },
    ),
    "second client must receive host movement",
  );
  await walk(second, "d", 320);
  const movedGuest = (await state()).find((m) => m.player.id === guest).player;
  assert(
    movedGuest.x > initial.find((m) => m.player.id === guest).player.x + 0.2,
    "guest must move independently",
  );
  assert(
    await page.evaluate(
      ({ guest, x }) =>
        window.__roomieReceived.some(
          (ms) =>
            Array.isArray(ms) &&
            ms.some((m) => m.player.id === guest && m.player.x >= x - 0.05),
        ),
      { guest, x: movedGuest.x },
    ),
    "host must receive guest movement",
  );
  // No movement or world reset when changing the camera.
  await page.bringToFront();
  const preCamera = (await state()).find((m) => m.player.id === host).player;
  await page.keyboard.press("v");
  assert(
    (await page
      .getByRole("button", { name: "アバター目線", exact: true })
      .getAttribute("aria-pressed")) === "true",
    "V switches to first person",
  );
  await page.waitForTimeout(250);
  const postCamera = (await state()).find((m) => m.player.id === host).player;
  assert(
    preCamera.x === postCamera.x &&
      preCamera.z === postCamera.z &&
      preCamera.area === postCamera.area,
    "camera must preserve coordinates",
  );
  await walk(page, "w", 240);
  const firstMoved = (await state()).find((m) => m.player.id === host).player;
  assert(
    firstMoved.x > postCamera.x + 0.2 &&
      Math.abs(firstMoved.z - postCamera.z) < 0.01,
    "first-person W must move along the facing direction",
  );
  await page.keyboard.press("q");
  await page.screenshot({ path: "output/playwright/first-person.png" });
  await page.keyboard.press("v");
  // Walk back to the doorway, then walk out and back through it.
  const beforeDoor = (await state()).find((m) => m.player.id === host).player;
  await walk(page, "a", ((beforeDoor.x - 0.3) / 3) * 1000);
  await walk(page, "s", 1100);
  await page
    .getByRole("heading", { name: "こもれびの街", exact: true })
    .waitFor();
  await second.getByText("街をおさんぽ中", { exact: true }).waitFor();
  assert(
    (await state()).find((m) => m.player.id === guest).player.area === "home",
    "guest must stay in Home",
  );
  await page.screenshot({ path: "output/playwright/town.png" });
  await walk(page, "w", 1100);
  await page
    .getByRole("heading", { name: "ふたりのおうち", exact: true })
    .waitFor();
  await second.getByText("同じ場所にいます", { exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/two-players.png" });
  const third = await context.newPage();
  await third.goto(invite);
  await third
    .getByRole("button", { name: "ルームに参加する", exact: true })
    .click();
  await third.getByRole("alert").filter({ hasText: "満員" }).waitFor();
  assert((await state()).length === 2, "third participant must not enter");
  await third.close();
  await second.close();
  await page
    .getByRole("button", { name: "ふたりで遊ぶ 1/2" })
    .waitFor({ timeout: 16000 });
  assert(!errors.length, "no runtime errors: " + errors.join("; "));
  await page.getByRole("button", { name: "ふたりで遊ぶ 1/2" }).click();
  await page.getByRole("button", { name: "ルームから退出する" }).click();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  console.log(
    "PASS: 2 clients, bidirectional movement, camera coordinates, Home/Town isolation and return, full-room rejection, abnormal disconnect.",
  );
}
