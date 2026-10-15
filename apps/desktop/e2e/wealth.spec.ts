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
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await lastCall(page, "save_wealth_account"))?.account).toMatchObject({
    name: "บัญชีต่างประเทศ",
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
  await page.getByRole("button", { name: "พื้นที่ภาษีของฉัน", exact: true }).click();
  await expect(page.getByRole("button", { name: "การลงทุนของฉัน", exact: true })).toBeVisible();
});

test("portfolio shows Rust-calculated values, filters, and accessible light/dark charts", async ({
  page,
}) => {
  await installWealthIpc(page);
  await openWealth(page);
  await expect(page.getByRole("heading", { name: "10,635.00 THB", exact: true })).toBeVisible();
  await page.getByLabel("กรองบัญชีลงทุน").selectOption("account-thb");
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
  await page.getByRole("button", { name: "ราคาและสกุลเงิน", exact: true }).click();
  await expect(page.getByRole("button", { name: "รีเฟรชราคาและ FX", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "เปิดการดึงข้อมูลตลาด", exact: true }).click();
  await page.getByRole("button", { name: "รีเฟรชราคาและ FX", exact: true }).click();
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
