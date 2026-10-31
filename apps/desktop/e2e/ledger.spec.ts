import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installIpc, lastCall, openDashboard } from "./ipc";

async function openLedger(page: Page) {
  await installIpc(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "รายรับรายจ่ายของฉัน" }).first().click();
  await expect(page.getByRole("heading", { name: "รายรับรายจ่าย", exact: true })).toBeVisible();
}
const dialog = (page: Page) => page.getByRole("dialog");

test("records an expense and summarizes the month", async ({ page }) => {
  await openLedger(page);
  await page.getByRole("button", { name: "รายจ่าย", exact: true }).click();
  await dialog(page).getByLabel("วันที่").fill("2026-03-04");
  await dialog(page).getByLabel("จำนวนเงิน (บาท)").fill("1,250.50");
  await dialog(page).getByLabel("บันทึกช่วยจำ").fill("ข้าวเย็น");
  await dialog(page).getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(await lastCall(page, "save_ledger_entry")).toEqual({
    request: {
      id: null,
      date: "2026-03-04",
      category_id: "expense-food",
      amount: "1250.50",
      note: "ข้าวเย็น",
      tax: null,
    },
  });
  await page.locator(".ledger-month").first().getByLabel("ปี").selectOption("2026");
  await page
    .locator(".ledger-month")
    .first()
    .getByLabel("เดือน", { exact: true })
    .selectOption("3");
  await expect(page.getByRole("region", { name: "สรุปมีนาคม 2569" })).toContainText("1,250.50");
  await expect(page.getByText("อาหารและเครื่องดื่ม")).toBeVisible();
});

test("linked income sends its tax details", async ({ page }) => {
  await openLedger(page);
  await page.getByRole("button", { name: "รายรับ", exact: true }).click();
  await dialog(page).getByLabel("วันที่").fill("2026-02-10");
  await dialog(page).getByLabel("จำนวนเงิน (บาท)").fill("10000");
  await dialog(page).getByRole("radio", { name: "รายได้เสริม" }).check();
  await dialog(page)
    .getByText(/นับรายการนี้เป็นรายได้/)
    .click();
  await dialog(page).getByLabel("ผู้จ่ายเงิน / นายจ้าง").fill("ลูกค้า ก");
  await dialog(page).getByRole("button", { name: "3%" }).click();
  await dialog(page).getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(await lastCall(page, "save_ledger_entry")).toMatchObject({
    request: {
      category_id: "income-side",
      amount: "10000.00",
      tax: { source_label: "ลูกค้า ก", kind: "other", withholding: "300.00" },
    },
  });
  await page.getByRole("button", { name: "รายการ", exact: true }).first().click();
  await page.locator(".ledger-month").first().getByLabel("ปี").selectOption("2026");
  await page
    .locator(".ledger-month")
    .first()
    .getByLabel("เดือน", { exact: true })
    .selectOption("2");
  await expect(page.getByText("นับภาษี")).toBeVisible();
});

test("CSV import maps split columns and skips unreadable rows", async ({ page }) => {
  await openLedger(page);
  await page.getByRole("button", { name: "นำเข้า CSV", exact: true }).first().click();
  await page.getByRole("button", { name: "เลือกไฟล์ CSV" }).click();
  await expect(
    page.getByText("จำนวนเงินอ่านไม่ได้").or(page.getByText("วันที่อ่านไม่ได้")),
  ).toBeVisible();
  await page.getByRole("button", { name: "นำเข้า 2 รายการ" }).click();
  expect(await lastCall(page, "import_ledger_entries")).toEqual({
    rows: [
      { date: "2026-03-01", category_id: "expense-food", amount: "65.00", note: "ร้านกาแฟ" },
      { date: "2026-03-02", category_id: "income-salary", amount: "1500.00", note: "รับโอน" },
    ],
  });
});

test("ledger screens are accessible and fit a phone", async ({ page }) => {
  await openLedger(page);
  for (const name of ["สรุปรายเดือน", "รายการ", "หมวดหมู่", "นำเข้า CSV"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      name,
    ).toEqual([]);
  }
  await page.getByRole("button", { name: "สรุปรายเดือน", exact: true }).first().click();
  await page.getByRole("button", { name: "รายจ่าย", exact: true }).click();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "../../output/playwright/ledger-mobile.png", fullPage: true });
});
