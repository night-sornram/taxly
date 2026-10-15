import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installIpc, lastCall, openDashboard } from "./ipc";

test("dashboard explains authoritative fixture and keeps the settlement gate closed", async ({
  page,
}) => {
  await installIpc(page);
  await openDashboard(page);
  await expect(page.locator(".tax-hero")).toContainText("2,050.00");
  await expect(page.locator(".income-summary")).toContainText("360,000.00");
  await expect(page.getByText("ส่วนต่างเชิงคำนวณเท่านั้น:", { exact: true })).toBeVisible();
  await expect(
    page.getByText("ยังไม่ใช่ยอดชำระหรือคืน ต้องยืนยันวิธีปัดเศษและตรวจข้อมูลก่อน", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ตัวเลขนี้มาจากไหน" }).click();
  await expect(page.getByRole("heading", { name: "ทำไมได้ตัวเลขนี้?" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ยกเว้นเงินได้สุทธิช่วงแรก", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("อัตราตามกฎหมาย 5%", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2,050.00", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "เปิดเอกสาร", exact: true }).first().click();
  expect((await lastCall(page, "open_source"))?.sourceId).toBe("rd91");
});

test("replaces a forecast in place and preserves unknown withholding", async ({ page }) => {
  await installIpc(page, true);
  await openDashboard(page);
  await page.getByRole("button", { name: "รายได้ของฉัน", exact: true }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(12);
  await page.getByRole("button", { name: "แก้ไขเงินเดือน กรกฎาคม", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("สถานะของจำนวนนี้").selectOption("actual");
  await dialog.getByLabel("ภาษีที่ถูกหัก (บาท)", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "บันทึกรายได้", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(12);
  expect((await lastCall(page, "upsert_income"))?.request).toMatchObject({
    basis: "actual",
    withholding: null,
    month: 7,
    gross: "30000.00",
  });
});

test("income add and delete have explicit user actions", async ({ page }) => {
  await installIpc(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "เพิ่มรายได้", exact: true }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "ประเภท", exact: true }).selectOption("bonus");
  await dialog.getByLabel("รายได้ก่อนหัก (บาท)", { exact: true }).fill("๑๐,๐๐๐");
  await dialog.getByRole("button", { name: "บันทึกรายได้", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await lastCall(page, "upsert_income"))?.request).toMatchObject({
    kind: "bonus",
    gross: "10000.00",
    withholding: null,
  });
  await page.getByRole("button", { name: "รายได้ของฉัน", exact: true }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(13);
  const bonus = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "โบนัส", exact: true }) });
  await bonus.getByRole("button", { name: "ลบรายได้ มกราคม", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("10,000.00");
  await dialog.getByRole("button", { name: "เก็บไว้ก่อน", exact: true }).click();
  expect(await lastCall(page, "delete_income")).toBeUndefined();
  await bonus.getByRole("button", { name: "ลบรายได้ มกราคม", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "ลบรายการ", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(12);
});

test("beginner onboarding sends explicit inputs and never replaces unknown by zero", async ({
  page,
}) => {
  await installIpc(page);
  await page.goto("/");
  await page.getByRole("button", { name: "เริ่มเรื่องภาษีของฉัน" }).click();
  for (const group of [
    "คุณเป็นโสดตลอดปีภาษีนี้ใช่ไหม?",
    "ปีนี้คุณอายุต่ำกว่า 65 ปีใช่ไหม?",
    "มีเฉพาะเงินเดือนหรือโบนัสในประเทศไทยใช่ไหม?",
    "ไม่มีสิทธิยกเว้นพิเศษหรือเงินก้อนออกจากงานใช่ไหม?",
  ]) {
    await page
      .getByRole("group", { name: group, exact: true })
      .getByRole("radio", { name: "ใช่", exact: true })
      .check();
  }
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("ชื่อนายจ้าง / ชื่อที่คุณจำได้", { exact: true }).fill("บริษัทของฉัน");
  await page.getByLabel("เงินเดือนต่อเดือน (บาท)", { exact: true }).fill("30,000");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page
    .getByRole("combobox", { name: "ตรวจเงินเดือนตามจำนวนที่กรอกแล้ว ถึงเดือน", exact: true })
    .selectOption("6");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("โบนัส (บาท)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("ประกันสังคมต่อเดือน (บาท)", { exact: true }).fill("0");
  await page
    .getByRole("checkbox", {
      name: "ตรวจแล้วว่าเป็นยอดที่เข้าเงื่อนไข",
      exact: false,
    })
    .check();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("group").getByRole("radio", { name: "ใช่", exact: true }).check();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "ฉันบันทึกหรือประมาณรายได้ทั้งปีครบ",
      exact: false,
    })
    .check();
  await page.getByRole("button", { name: "ดูภาพรวมภาษีของฉัน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "เห็นภาพภาษี สบายใจขึ้นอีกนิด" })).toBeVisible();
  expect((await lastCall(page, "save_onboarding"))?.request).toMatchObject({
    year: 2026,
    monthly_salary: "30000.00",
    monthly_withholding: null,
    forecast_withholding: false,
    actual_through: 6,
    monthly_sso: "0.00",
    income_complete: true,
  });
  expect(await lastCall(page, "save_onboarding_draft")).toBeDefined();
});

test("backup validates passwords and restore requires review before replacement", async ({
  page,
}) => {
  await installIpc(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "ข้อมูลของฉัน", exact: true }).first().click();
  await page.getByRole("button", { name: "สร้างไฟล์สำรอง", exact: false }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("รหัสผ่านสำหรับไฟล์สำรอง", { exact: true }).fill("a private passphrase");
  await dialog.getByLabel("ยืนยันรหัสผ่าน", { exact: true }).fill("something different");
  await dialog.getByRole("button", { name: "เลือกที่เก็บไฟล์", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ไม่ตรงกัน");
  expect(await lastCall(page, "export_backup")).toBeUndefined();
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await page.getByRole("button", { name: "กู้คืนจากไฟล์", exact: false }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("รหัสผ่านของไฟล์สำรอง", { exact: true }).fill("a private passphrase");
  await dialog.getByRole("button", { name: "เลือกและตรวจไฟล์", exact: true }).click();
  await expect(dialog).toContainText("12 รายการ");
  await expect(
    dialog.getByRole("button", { name: "ยืนยันกู้คืนข้อมูล", exact: true }),
  ).toBeDisabled();
  expect(await lastCall(page, "restore_backup")).toBeUndefined();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "ยืนยันกู้คืนข้อมูล", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await lastCall(page, "restore_backup")).toEqual({
    token: "test-token",
  });
});

test("mobile layout keeps primary navigation and content within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installIpc(page);
  await openDashboard(page);
  await expect(
    page.getByRole("navigation", { name: "เมนูสำหรับหน้าจอเล็ก", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "../../output/playwright/dashboard-mobile.png",
    fullPage: true,
  });
});

test("dashboard and initial onboarding meet automated accessibility checks", async ({ page }) => {
  await installIpc(page);
  await page.goto("/");
  let result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  await page.getByRole("combobox", { name: "เปลี่ยนปีภาษี", exact: true }).selectOption("2025");
  await expect(page.getByRole("heading", { name: "เห็นภาพภาษี สบายใจขึ้นอีกนิด" })).toBeVisible();
  result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: "../../output/playwright/dashboard-desktop.png",
    fullPage: true,
  });
});

test("all main screens and the income dialog remain accessible", async ({ page }) => {
  await installIpc(page);
  await openDashboard(page);
  for (const name of [
    "รายได้ของฉัน",
    "สิทธิ์ลดหย่อน",
    "เข้าใจการคำนวณ",
    "ผลสรุปที่บันทึก",
    "ข้อมูลของฉัน",
  ]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          reason: node.failureSummary,
        })),
      })),
      name,
    ).toEqual([]);
  }
  await page.getByRole("button", { name: "รายได้ของฉัน", exact: true }).first().click();
  await page.getByRole("button", { name: "เพิ่มรายได้", exact: true }).first().click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
