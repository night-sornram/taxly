import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { emptySnapshot } from "../src/sync/model";
import type { Snapshot } from "../src/sync/model";

// Synthetic Supabase wire responses. Two isolated browser profiles share this
// cloud, while each profile uses its real IndexedDB and production auth client.
class TestCloud {
  revision = 0;
  snapshot = emptySnapshot();
  receipts = new Map<string, number>();
  sockets = new Set<{ socket: WebSocketRoute; topic: string }>();
  owner = "11111111-1111-4111-8111-111111111111";
  async install(context: BrowserContext) {
    await context.addInitScript(() => {
      localStorage.setItem(
        "taxly-cloud-config",
        JSON.stringify({
          url: "https://taxly-e2e.supabase.co",
          key: "sb_publishable_taxly_synthetic_e2e_key",
          webUrl: "",
        }),
      );
    });
    await context.route("https://taxly-e2e.supabase.co/**", async (route) => {
      const url = new URL(route.request().url());
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
      const respond = (body: unknown, status = 200) =>
        route.fulfill({ status, headers, json: body });
      if (route.request().method() === "OPTIONS") return respond({});
      if (url.pathname.startsWith("/auth/v1/token")) {
        const user = {
          id: this.owner,
          aud: "authenticated",
          role: "authenticated",
          email: "taxly@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        };
        const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: this.owner, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic-signature`;
        return respond({
          access_token: token,
          refresh_token: "synthetic-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user,
        });
      }
      if (url.pathname === "/auth/v1/logout") return respond({});
      if (url.pathname.endsWith("/taxly_get_ledger"))
        return respond({ revision: this.revision, snapshot: this.snapshot });
      if (url.pathname.endsWith("/taxly_put_ledger")) {
        const body = route.request().postDataJSON() as {
          expected_revision: number;
          next_snapshot: Snapshot;
          operation_id: string;
        };
        const receipt = this.receipts.get(body.operation_id);
        if (receipt !== undefined) return respond(receipt);
        if (body.expected_revision !== this.revision)
          return respond({ code: "40001", message: "SyncConflict" }, 409);
        this.snapshot = structuredClone(body.next_snapshot);
        this.revision++;
        this.receipts.set(body.operation_id, this.revision);
        const response = respond(this.revision);
        for (const { socket, topic } of this.sockets)
          socket.send(
            JSON.stringify([
              null,
              null,
              topic,
              "postgres_changes",
              {
                ids: [1],
                data: {
                  schema: "public",
                  table: "taxly_sync_heads",
                  type: "UPDATE",
                  columns: [
                    { name: "owner_id", type: "uuid" },
                    { name: "revision", type: "int8" },
                  ],
                  commit_timestamp: new Date().toISOString(),
                  record: { owner_id: this.owner, revision: this.revision },
                  old_record: {},
                  errors: null,
                },
              },
            ]),
          );
        return response;
      }
      return respond({ message: `Unexpected synthetic request: ${url.pathname}` }, 404);
    });
    await context.routeWebSocket("wss://taxly-e2e.supabase.co/**", (socket) => {
      socket.onMessage((raw) => {
        const parsed = JSON.parse(String(raw));
        const message = Array.isArray(parsed)
          ? {
              join_ref: parsed[0],
              ref: parsed[1],
              topic: parsed[2],
              event: parsed[3],
              payload: parsed[4],
            }
          : parsed;
        if (message.event === "phx_join") {
          const channel = { socket, topic: message.topic };
          this.sockets.add(channel);
          socket.onClose(() => {
            this.sockets.delete(channel);
          });
          socket.send(
            JSON.stringify([
              message.join_ref,
              message.ref,
              message.topic,
              "phx_reply",
              {
                status: "ok",
                response: {
                  postgres_changes: [{ id: 1, ...message.payload.config.postgres_changes[0] }],
                },
              },
            ]),
          );
        } else if (message.event === "heartbeat" || message.event === "phx_leave") {
          socket.send(
            JSON.stringify([
              message.join_ref,
              message.ref,
              message.topic,
              "phx_reply",
              { status: "ok", response: {} },
            ]),
          );
        }
      });
    });
  }
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("อีเมล", { exact: true }).fill("taxly@example.test");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "รายรับรายจ่าย", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "บัญชีและการซิงก์" })).toContainText("ซิงก์แล้ว");
}
async function addExpense(page: Page, note: string, amount: string) {
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("วันที่").fill("2026-10-31");
  await dialog.getByLabel("จำนวนเงิน (บาท)").fill(amount);
  await dialog.getByLabel("บันทึกช่วยจำ").fill(note);
  await dialog.getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(dialog).not.toBeVisible();
}
async function entries(page: Page) {
  await page.getByRole("button", { name: "รายการ", exact: true }).last().click();
  await page.locator(".ledger-month").getByLabel("ปี").selectOption("2026");
  await page.locator(".ledger-month").getByLabel("เดือน", { exact: true }).selectOption("10");
}

test("phone syncs live with another device and keeps offline writes through reload", async ({
  browser,
}) => {
  const cloud = new TestCloud();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
  });
  await cloud.install(phone);
  await cloud.install(desktop);
  const a = await phone.newPage(),
    b = await desktop.newPage();
  await login(a);
  await login(b);
  await entries(b);
  await addExpense(a, "กาแฟจากโทรศัพท์", "65.50");
  await expect(b.getByRole("cell", { name: "กาแฟจากโทรศัพท์", exact: true })).toBeVisible({
    timeout: 5000,
  });
  await phone.setOffline(true);
  await addExpense(a, "บันทึกออฟไลน์", "10.25");
  // Reload while offline is covered separately against the real service worker;
  // reload online with failed cloud requests exercises persisted pending edits.
  await phone.setOffline(false);
  await phone.route("https://taxly-e2e.supabase.co/rest/**", (route) => route.abort());
  await a.reload();
  await entries(a);
  await expect(a.getByRole("cell", { name: "บันทึกออฟไลน์", exact: true })).toBeVisible();
  expect(cloud.snapshot.entries).toHaveLength(1);
  await phone.unroute("https://taxly-e2e.supabase.co/rest/**");
  await a.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(b.getByRole("cell", { name: "บันทึกออฟไลน์", exact: true })).toBeVisible({
    timeout: 5000,
  });
  // Edit/delete on the phone must also propagate via websocket, without a reload.
  const row = a.getByRole("row").filter({ hasText: "กาแฟจากโทรศัพท์" });
  await row.getByRole("button", { name: /แก้ไข/ }).click();
  await a.getByRole("dialog").getByLabel("จำนวนเงิน (บาท)").fill("70.50");
  await a.getByRole("dialog").getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(b.getByRole("row").filter({ hasText: "กาแฟจากโทรศัพท์" })).toContainText("70.50");
  await row.getByRole("button", { name: /ลบ/ }).click();
  await a.getByRole("dialog").getByRole("button", { name: "ลบรายการ", exact: true }).click();
  await expect(b.getByRole("cell", { name: "กาแฟจากโทรศัพท์", exact: true })).toHaveCount(0);
  await phone.close();
  await desktop.close();
});

test("mobile login and account screens are accessible at 320px in both themes", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const cloud = new TestCloud();
  await cloud.install(context);
  await page.goto("/");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await login(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const name of ["สรุปรายเดือน", "บัญชีและซิงก์"]) {
      await page.getByRole("button", { name, exact: true }).last().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => [n.target, n.failureSummary, theme, name]),
        })),
      ).toEqual([]);
    }
  }
  await page.screenshot({ path: "../../output/playwright/mobile-sync.png", fullPage: true });
});

test("installed phone app opens offline and uploads saved entries on reconnect", async ({
  context,
  page,
}) => {
  test.skip(!process.env.TAXLY_E2E_PREVIEW, "Offline shell requires a production build");
  await page.setViewportSize({ width: 390, height: 844 });
  const cloud = new TestCloud();
  await cloud.install(context);
  await login(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "รายรับรายจ่าย", exact: true })).toBeVisible();
  await addExpense(page, "ออฟไลน์หลังเปิดแอปใหม่", "25.75");
  await page.reload();
  await entries(page);
  await expect(
    page.getByRole("cell", { name: "ออฟไลน์หลังเปิดแอปใหม่", exact: true }),
  ).toBeVisible();
  expect(cloud.snapshot.entries).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(() => cloud.snapshot.entries.length).toBe(1);
  await expect(page.getByRole("button", { name: "บัญชีและการซิงก์" })).toContainText("ซิงก์แล้ว");
});
