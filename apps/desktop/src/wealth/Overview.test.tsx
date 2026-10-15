import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Overview from "./Overview";
import fixture from "../../e2e/fixtures/wealth-contract.json";
import type { WealthWorkspace } from "./types";
afterEach(cleanup);
it("distinguishes known partial value from an unavailable portfolio total", () => {
  const workspace = structuredClone(fixture.full) as WealthWorkspace;
  workspace.portfolio.total_value = null;
  workspace.portfolio.period_gain = null;
  workspace.portfolio.twr = null;
  workspace.portfolio.known_value = "9007199254740993.01";
  workspace.portfolio.quality = "partial";
  render(
    <Overview
      workspace={workspace}
      onAccount={vi.fn()}
      onActivity={vi.fn()}
      onOpening={vi.fn()}
      onImport={vi.fn()}
      onHoldings={vi.fn()}
    />,
  );
  expect(
    screen.getByText("มูลค่าที่ทราบ 9,007,199,254,740,993.01 THB · บางรายการยังไม่มีราคา"),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: /^—$/ }).length).toBe(3);
  expect(screen.getByRole("img", { name: /^กราฟมูลค่าพอร์ต/ })).toBeInTheDocument();
  expect(
    screen.getByRole("table", { name: "มูลค่าและผลตอบแทนรายวัน", hidden: true }),
  ).toBeInTheDocument();
});
