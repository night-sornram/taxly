import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { lastCall } from "./ipc";
import { installWealthIpc, openWealth } from "./wealth-ipc";

test("wealth is available before tax onboarding and accepts account opening cash", async ({
  page,
}) => {
  await installWealthIpc(page, true);
  await openWealth(page);
  await expect(page.getByRole("combobox", { name: "ปีภาษี", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "สร้างบัญชีลงทุนแรก" }).click();
  await page.getByLabel("ชื่อบัญชี", { exact: true }).fill("บัญชีต่างประเทศ");
  await page.getByText("ติดตามเงินสดในบัญชีนี้").click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await lastCall(page, "save_wealth_account"))?.account).toMatchObject({
    name: "บัญชีต่างประเทศ",
    track_cash: true,
  });
  await page.getByRole("button", { name: "เริ่มจากยอดปัจจุบัน" }).click();
  await page.getByLabel("วันตั้งต้น (ค.ศ.)", { exact: true }).fill("2026-01-01");
  await page.getByLabel("เงินสดตั้งต้น", { exact: true }).fill("1234567890.123456");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await lastCall(page, "save_wealth_opening"))?.opening).toMatchObject({
    quantity: "1234567890.123456",
    instrument_id: null,
    cost_basis: null,
    date: "2026-01-01",
  });
  await page.getByRole("button", { name: "ภาษีของฉัน", exact: true }).click();
  await expect(page.getByRole("button", { name: "การลงทุนของฉัน", exact: true })).toBeVisible();
});

test("portfolio shows Rust-calculated values, filters, and accessible light/dark charts", async ({
  page,
}) => {
  await installWealthIpc(page);
  await openWealth(page);
  await expect(page.getByRole("heading", { name: "10,635.00 THB", exact: true })).toBeVisible();
  await page.getByLabel("กรองตามบัญชี").selectOption("account-thb");
  await expect
    .poll(
      async () =>
        ((await lastCall(page, "get_wealth_workspace"))?.filter as { account_ids: string[] })
          .account_ids,
    )
    .toEqual(["account-thb"]);
  await page.getByLabel("วันที่สิ้นสุดช่วง (ค.ศ.)").fill("2026-01-03");
  await page.getByRole("button", { name: "ใช้ช่วงวันที่", exact: true }).click();
  await expect(page.getByRole("img", { name: /^กราฟมูลค่าพอร์ต/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/wealth-overview.png", fullPage: true });
  await page.getByRole("button", { name: "เปิดธีมมืด" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }).click();
  await page.getByLabel("ค้นหาหลักทรัพย์").fill("PTT");
  await expect(
    page.getByRole("table", { name: "หลักทรัพย์ในพอร์ต" }).getByText("354.00", { exact: true }),
  ).toBeVisible();
});

test("manual trades preserve decimal strings and final cash amount", async ({ page }) => {
  await installWealthIpc(page);
  await openWealth(page);
  await page.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  await page.getByLabel("ประเภทรายการ", { exact: true }).selectOption("buy");
  await page.getByLabel("หลักทรัพย์", { exact: true }).selectOption("ptt");
  await page.getByLabel("วันที่ (ค.ศ.)", { exact: true }).fill("2026-01-03");
  await page.getByLabel("จำนวนหน่วย", { exact: true }).fill("0.123456789012");
  await page.getByLabel("ราคาต่อหน่วย", { exact: true }).fill("100");
  await expect(
    page.getByText(/ขายที่ราคาปัจจุบัน 160\.00 \(.*กำไร\/ขาดทุน [\d.]+ \(59\.92%\)/),
  ).toBeVisible();
  await expect(page.getByText(/กำไร\/ขาดทุน [\d.,]+ \(/)).toBeVisible();
  await page.getByLabel("ค่าธรรมเนียม", { exact: true }).fill("0.01");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await lastCall(page, "save_wealth_activity"))?.activity).toMatchObject({
    kind: "buy",
    quantity: "0.123456789012",
    unit_price: "100",
    amount: null,
    fee: "0.01",
    currency: "THB",
  });
});

test("holdings load remote company logos only after market data is enabled", async ({ page }) => {
  const requests: { url: string; referer?: string }[] = [];
  await page.route("https://financialmodelingprep.com/image-stock/**", async (route) => {
    requests.push({ url: route.request().url(), referer: route.request().headers().referer });
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  await installWealthIpc(page);
  await openWealth(page);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "ราคาและอัตราแลกเปลี่ยน", exact: true }).click();
  await page.getByRole("button", { name: "เปิดการดึงข้อมูลตลาด", exact: true }).click();
  await expect(page.getByRole("button", { name: "ปิดการดึงข้อมูลตลาด" })).toBeVisible();
  await page.getByRole("button", { name: "ภาพรวม", exact: true }).click();
  const overviewLogo = page
    .getByRole("table", { name: "หลักทรัพย์และมูลค่าในสกุลรายงาน" })
    .locator("img");
  await expect(overviewLogo).toBeVisible();
  await expect
    .poll(() => overviewLogo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }).click();
  const holdingsLogo = page.getByRole("table", { name: "หลักทรัพย์ในพอร์ต" }).locator("img");
  await expect(holdingsLogo).toBeVisible();
  await expect
    .poll(() => holdingsLogo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (request) =>
        request.url === "https://financialmodelingprep.com/image-stock/PTT.BK.png" &&
        request.referer === undefined,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "ราคาและอัตราแลกเปลี่ยน", exact: true }).click();
  await page.getByRole("button", { name: "ปิดการดึงข้อมูลตลาด", exact: true }).click();
  await expect(page.getByRole("button", { name: "เปิดการดึงข้อมูลตลาด" })).toBeVisible();
  await page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }).click();
  await expect(holdingsLogo).toHaveCount(0);
});

test("CSV preview skips duplicates and commits only reviewed rows", async ({ page }) => {
  await installWealthIpc(page);
  await openWealth(page);
  await page.getByRole("button", { name: "นำเข้า CSV", exact: true }).click();
  await page.getByRole("button", { name: "เลือกไฟล์ CSV", exact: true }).click();
  await expect(page.getByLabel("นำเข้าแถว 1", { exact: true })).toBeChecked();
  await expect(page.getByLabel("นำเข้าแถว 2", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "ยืนยันนำเข้า 1 รายการ", exact: true }).click();
  await expect(page.getByText("นำเข้าแล้ว 1 รายการ · ข้าม 1 รายการ")).toBeVisible();
  expect(await lastCall(page, "commit_wealth_import")).toEqual({
    token: "review-token",
    includeRows: [1],
  });
});

test("market refresh is optional and partial failures keep the cached price table", async ({
  page,
}) => {
  await installWealthIpc(page);
  await openWealth(page);
  await page.getByRole("button", { name: "ราคาและอัตราแลกเปลี่ยน", exact: true }).click();
  // Refreshing while market data is off enables it in the same action.
  await page.getByRole("button", { name: "เปิดและรีเฟรชราคา", exact: true }).click();
  await expect(page.getByText("Yahoo Finance จำกัดจำนวนคำขอ โปรดลองภายหลัง")).toBeVisible();
  await expect(page.getByRole("table", { name: "ราคาที่เก็บในเครื่อง" })).toBeVisible();
  expect((await lastCall(page, "save_wealth_preferences"))?.preferences).toEqual({
    reporting_currency: "THB",
    market_data_enabled: true,
  });
});

test("wealth layout works on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWealthIpc(page);
  await openWealth(page);
  await expect(page.getByLabel("เลือกหน้าการลงทุน")).toBeVisible();
  await page.getByLabel("เลือกหน้าการลงทุน").selectOption("accounts");
  await expect(page.getByRole("heading", { name: "บัญชีลงทุน", exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.width);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("editor modal is centered in the viewport", async ({ page }) => {
  await installWealthIpc(page);
  await openWealth(page);
  await page.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(box).not.toBeNull();
  // Tailwind preflight zeroes dialog margin; .modal restores margin:auto so the
  // native <dialog> centers instead of sticking to the viewport top-left.
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
});

test("switching between tax and wealth keeps state without refetching", async ({ page }) => {
  await installWealthIpc(page);
  await openWealth(page);
  const switcher = page.getByRole("group", { name: "เลือกส่วนการใช้งาน", exact: true });
  await expect(switcher.getByRole("button", { name: "การลงทุนของฉัน" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const wealthPosition = await switcher.boundingBox();
  await page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }).click();
  await page.getByLabel("ค้นหาหลักทรัพย์").fill("PTT");
  const countWorkspaceFetches = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __TAXLY_TEST_CALLS__?: { name: string }[] }
        ).__TAXLY_TEST_CALLS__?.filter((call) => call.name === "get_wealth_workspace").length,
    );
  const before = await countWorkspaceFetches();
  // Switch to tax (year 2026 has no profile yet, so onboarding shows) and open
  // the 2025 dashboard, then return: wealth must still be on holdings.
  await page.getByRole("button", { name: "ภาษีของฉัน", exact: true }).click();
  await page.getByRole("combobox", { name: "เปลี่ยนปีภาษี", exact: true }).selectOption("2025");
  await expect(page.getByRole("heading", { name: "เห็นภาพภาษี สบายใจขึ้นอีกนิด" })).toBeVisible();
  await expect(switcher.getByRole("button", { name: "ภาษีของฉัน" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await switcher.boundingBox()).toEqual(wealthPosition);
  await page.getByRole("button", { name: "รายได้ของฉัน", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "รายได้ของฉัน", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Selecting the current area keeps the current page.
  await switcher.getByRole("button", { name: "ภาษีของฉัน" }).click();
  await expect(page.getByRole("button", { name: "รายได้ของฉัน", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "การลงทุนของฉัน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "หลักทรัพย์ในพอร์ต", exact: true })).toBeVisible();
  await expect(page.getByLabel("ค้นหาหลักทรัพย์")).toHaveValue("PTT");
  await expect(
    page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "ภาษีของฉัน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "รายได้ของฉัน", exact: true })).toBeVisible();
  expect(await countWorkspaceFetches()).toBe(before);
});

for (const width of [740, 390]) {
  test(`area switching stays accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installWealthIpc(page);
    await openWealth(page);
    const switcher = page.getByRole("group", { name: "เลือกส่วนการใช้งาน", exact: true });
    const wealthPosition = await switcher.boundingBox();
    await switcher.getByRole("button", { name: "ภาษีของฉัน" }).click();
    await page.getByRole("combobox", { name: "เปลี่ยนปีภาษี" }).selectOption("2025");
    await expect(page.getByRole("heading", { name: "เห็นภาพภาษี สบายใจขึ้นอีกนิด" })).toBeVisible();
    await expect(switcher.getByRole("button", { name: "ภาษีของฉัน" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await switcher.boundingBox()).toEqual(wealthPosition);
    await switcher.getByRole("button", { name: "การลงทุนของฉัน" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "ภาพรวมการลงทุน", exact: true })).toBeVisible();
    await expect(switcher.getByRole("button", { name: "การลงทุนของฉัน" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("instrument search autofills fields and totals derive the buy price", async ({ page }) => {
  await installWealthIpc(page, true);
  await openWealth(page);
  // Market data must be on before searching; enable it on the market page.
  await page.getByRole("button", { name: "ราคาและอัตราแลกเปลี่ยน", exact: true }).click();
  await page.getByRole("button", { name: "เปิดการดึงข้อมูลตลาด", exact: true }).click();
  await page.getByRole("button", { name: "หลักทรัพย์ในพอร์ต", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มหลักทรัพย์", exact: true }).click();
  await page.getByLabel("สัญลักษณ์", { exact: true }).fill("PTT");
  await page.getByRole("button", { name: "ค้นหาจาก Yahoo Finance" }).click();
  await page.getByRole("option", { name: /ปตท\./ }).click();
  await expect(page.getByLabel("ชื่อหลักทรัพย์")).toHaveValue("ปตท. (PTT PCL)");
  await expect(page.getByLabel("สกุลเงิน")).toHaveValue("THB");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await lastCall(page, "save_wealth_instrument"))?.instrument).toMatchObject({
    symbol: "PTT",
    exchange: "SET",
    currency: "THB",
    provider_symbol: "PTT.BK",
  });
  // A buy entered with only the total derives the unit price for the ledger.
  await page.getByRole("button", { name: "รายการลงทุน", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  // An empty portfolio opens the account editor before the activity editor.
  await page.getByLabel("ชื่อบัญชี").fill("บัญชีหลัก");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("ประเภทรายการ").selectOption("buy");
  await editor.getByLabel("หลักทรัพย์").selectOption({ label: "PTT · ปตท. (PTT PCL) (THB)" });
  await editor.getByLabel("จำนวนหน่วย").fill("100");
  await expect(page.getByText("ยังไม่มีราคาล่าสุดของหลักทรัพย์นี้ในระบบ")).toBeVisible();
  await editor.getByLabel("เงินสดสุทธิ").fill("10100");
  await expect(page.getByText(/จะใช้ราคาต่อหน่วย 101\.00/)).toBeVisible();
  // Holdings-only account: the buy is recorded directly with zero cash,
  // while cash records remain available on the same account.
  await expect(editor.getByRole("option", { name: "ฝากเงิน" })).toHaveCount(1);
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (
      window as unknown as { __TAXLY_TEST_CALLS__: { name: string; args: unknown }[] }
    ).__TAXLY_TEST_CALLS__.filter((call) => call.name === "save_wealth_activity"),
  );
  expect(calls.map((call) => (call.args as { activity: { kind: string } }).activity.kind)).toEqual([
    "buy",
  ]);
  expect((await lastCall(page, "save_wealth_activity"))?.activity).toMatchObject({
    unit_price: "101.00",
    amount: null,
  });
});
