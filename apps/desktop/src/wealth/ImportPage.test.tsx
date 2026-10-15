import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportPage from "./ImportPage";
import { command } from "../api";
import fixture from "../../e2e/fixtures/wealth-contract.json";
import type { ImportReview, WealthData } from "./types";
vi.mock("../api", () => ({
  command: vi.fn(),
  errorMessage: (e: unknown) => String(e),
  isCancelled: () => false,
}));
const invoke = vi.mocked(command);
const review: ImportReview = {
  token: "review-token",
  revision: 4,
  filename: "broker.csv",
  headers: ["date", "amount"],
  mapping: { date: "date", amount: "amount" },
  mode: "activities",
  account_id: "account-thb",
  new_instruments: [],
  rows: [
    {
      index: 1,
      values: { date: "2026-01-01", amount: "100" },
      activity: null,
      opening: null,
      duplicate: false,
      errors: [],
    },
    {
      index: 2,
      values: { date: "2026-01-02", amount: "200" },
      activity: null,
      opening: null,
      duplicate: true,
      errors: [],
    },
    {
      index: 3,
      values: { date: "bad", amount: "300" },
      activity: null,
      opening: null,
      duplicate: false,
      errors: ["วันที่ไม่ถูกต้อง"],
    },
  ],
};
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (name) =>
    name === "preview_wealth_import"
      ? review
      : name === "commit_wealth_import"
        ? { imported: 2, skipped: 1 }
        : undefined,
  );
});
afterEach(cleanup);
function setup() {
  const changed = vi.fn(async () => {});
  render(
    <ImportPage data={fixture.full.data as WealthData} onChanged={changed} onAccount={vi.fn()} />,
  );
  return changed;
}
it("previews native files without saving and defaults duplicates to skipped", async () => {
  const changed = setup();
  fireEvent.click(screen.getByRole("button", { name: "เลือกไฟล์ CSV" }));
  expect(await screen.findByRole("checkbox", { name: "นำเข้าแถว 1" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "นำเข้าแถว 2" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "นำเข้าแถว 3" })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "นำเข้าแถว 2" }));
  fireEvent.click(screen.getByRole("button", { name: "ยืนยันนำเข้า 2 รายการ" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("commit_wealth_import", {
      token: "review-token",
      includeRows: [1, 2],
    }),
  );
  expect(await screen.findByText("นำเข้าแล้ว 2 รายการ · ข้าม 1 รายการ")).toBeInTheDocument();
  expect(changed).toHaveBeenCalledOnce();
});
it("requires a fresh preview after mappings change and passes the reviewed file token", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "เลือกไฟล์ CSV" }));
  await screen.findByRole("checkbox", { name: "นำเข้าแถว 1" });
  fireEvent.change(screen.getByLabelText("เงินสดสุทธิ"), { target: { value: "date" } });
  expect(screen.getByRole("button", { name: "ยืนยันนำเข้า 1 รายการ" })).toBeDisabled();
  fireEvent.click(screen.getAllByRole("button", { name: "ตรวจตัวอย่างใหม่" })[1]);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("preview_wealth_import", {
      request: expect.objectContaining({
        file_token: "review-token",
        mapping: expect.objectContaining({ amount: "date" }),
      }),
    }),
  );
});
it("cancels a review without importing any rows", async () => {
  const changed = setup();
  fireEvent.click(screen.getByRole("button", { name: "เลือกไฟล์ CSV" }));
  fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกการนำเข้า" }));
  await waitFor(() => expect(screen.queryByText("broker.csv · 3 แถว")).not.toBeInTheDocument());
  expect(invoke).toHaveBeenCalledWith("cancel_wealth_import");
  expect(invoke).not.toHaveBeenCalledWith("commit_wealth_import", expect.anything());
  expect(changed).not.toHaveBeenCalled();
});
