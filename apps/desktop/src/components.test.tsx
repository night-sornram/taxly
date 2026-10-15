import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { Answer, Field } from "./components";
import Dashboard from "./Dashboard";
import fixture from "../e2e/fixtures/contract.json";
import type { Calculation, Workspace } from "./types";

it("links field label and hint with the editable input", () => {
  render(<Field label="จำนวนเงิน" hint="กรอกก่อนหัก" defaultValue="" />);
  const input = screen.getByLabelText("จำนวนเงิน");
  expect(input).toHaveAccessibleDescription("กรอกก่อนหัก");
});
it("keeps an unknown answer distinct from a negative answer", () => {
  const change = vi.fn();
  render(<Answer label="มีเงินได้ไหม?" value={null} onChange={change} />);
  expect(screen.getByRole("radio", { name: "ยังไม่แน่ใจ" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "ไม่ใช่" }));
  expect(change).toHaveBeenCalledWith(false);
});

it("does not present an empty incomplete year as zero tax", () => {
  const workspace = structuredClone(fixture.workspace) as Workspace;
  workspace.income = [];
  workspace.profile!.income_complete = false;
  render(
    <Dashboard
      data={fixture.calculation as Calculation}
      workspace={workspace}
      onNavigate={vi.fn()}
      onAdd={vi.fn()}
      onSave={vi.fn()}
      saving={false}
    />,
  );
  expect(screen.getByRole("heading", { name: "เริ่มจากรายได้รายการแรก" })).toBeInTheDocument();
  expect(screen.queryByText("ภาษีทั้งปีโดยประมาณ")).not.toBeInTheDocument();
});

it("labels each month bar by income kind so a bonus never reads as a bigger salary", () => {
  const workspace = structuredClone(fixture.workspace) as Workspace;
  workspace.income.push({
    id: "bonus-row",
    tax_year: workspace.year,
    source_id: workspace.income[0].source_id,
    month: 12,
    kind: "bonus",
    basis: "forecast",
    gross: "60000.00",
    withholding: null,
  });
  render(
    <Dashboard
      data={fixture.calculation as Calculation}
      workspace={workspace}
      onNavigate={vi.fn()}
      onAdd={vi.fn()}
      onSave={vi.fn()}
      saving={false}
    />,
  );
  const december = screen.getByRole("button", { name: /^ธ\.ค\./ });
  expect(december).toHaveAccessibleName(
    expect.stringContaining("เงินเดือน 30,000.00 บาท"),
  );
  expect(december).toHaveAccessibleName(expect.stringContaining("โบนัส 60,000.00 บาท"));
  expect(december.querySelector(".chart-bar .bonus")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^ม.ค\./ })).toHaveAccessibleName(
    expect.stringContaining("เงินเดือน 30,000.00 บาท"),
  );
});
