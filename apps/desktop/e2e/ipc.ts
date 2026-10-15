import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/contract.json", import.meta.url), "utf8"),
);

/** UI adapter only. Tax/SQLite/backup behavior is tested against Rust, never reimplemented here. */
export async function installIpc(page: Page, forecast = false) {
  await page.addInitScript(
    ({ fixture, forecast }) => {
      const original = structuredClone(fixture);
      const workspace = structuredClone(fixture.workspace);
      if (forecast) workspace.income[6].basis = "forecast";
      let draft: unknown = null;
      let created = false;
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      Object.defineProperty(window, "__TAXLY_TEST_CALLS__", { value: calls });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (name: string, args: Record<string, unknown> = {}) => {
            calls.push({ name, args });
            switch (name) {
              case "get_active_tax_year":
                return 2026;
              case "set_active_tax_year":
                return null;
              case "get_year_workspace":
                return args.year === 2025 || created
                  ? structuredClone(workspace)
                  : {
                      year: 2026,
                      profile: null,
                      sources: [],
                      income: [],
                      deductions: [],
                      draft,
                    };
              case "calculate_year":
                return structuredClone(fixture.calculation);
              case "get_rule_sources":
                return structuredClone(fixture.sources);
              case "get_deduction_guidance":
                return structuredClone(fixture.guidance);
              case "get_history":
                return structuredClone(fixture.history);
              case "save_onboarding_draft":
                draft = args.draft;
                return null;
              case "save_onboarding":
                created = true;
                return null;
              case "open_source":
              case "save_snapshot":
              case "cancel_restore":
                return null;
              case "save_profile":
                workspace.profile.facts = args.facts as typeof workspace.profile.facts;
                workspace.profile.income_complete = args.incomeComplete as boolean;
                workspace.profile.revision++;
                return null;
              case "upsert_income": {
                const request = args.request as {
                  id: string | null;
                  year: number;
                  source_label: string;
                  month: number;
                  kind: string;
                  basis: string;
                  gross: string;
                  withholding: string | null;
                };
                let source = workspace.sources.find(
                  (source) => source.label === request.source_label,
                );
                if (!source) {
                  source = {
                    id: `source-${workspace.sources.length}`,
                    tax_year: request.year,
                    label: request.source_label,
                  };
                  workspace.sources.push(source);
                }
                const entry = {
                  id: request.id ?? `new-${workspace.income.length}`,
                  tax_year: request.year,
                  source_id: source.id,
                  month: request.month,
                  kind: request.kind,
                  basis: request.basis,
                  gross: request.gross,
                  withholding: request.withholding,
                };
                const index = workspace.income.findIndex((entry) => entry.id === request.id);
                if (index >= 0) workspace.income[index] = entry;
                else workspace.income.push(entry);
                workspace.profile.revision++;
                return null;
              }
              case "delete_income":
                workspace.income = workspace.income.filter((entry) => entry.id !== args.id);
                workspace.profile.income_complete = false;
                return null;
              case "export_backup":
                throw { code: "Cancelled", message: "ยกเลิกแล้ว" };
              case "inspect_backup":
                return {
                  token: "test-token",
                  years: [2025],
                  income_count: 12,
                  deduction_count: 12,
                  snapshot_count: 1,
                  draft_count: 0,
                };
              case "restore_backup":
                Object.assign(workspace, structuredClone(original.workspace));
                return null;
              default:
                throw { message: `Unexpected test command: ${name}` };
            }
          },
        },
      });
    },
    { fixture, forecast },
  );
}
export async function openDashboard(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "เปลี่ยนปีภาษี", exact: true }).selectOption("2025");
  await page.getByRole("heading", { name: "เห็นภาพภาษี สบายใจขึ้นอีกนิด" }).waitFor();
}
export async function lastCall(page: Page, name: string) {
  return page.evaluate((name) => {
    const calls = (
      window as unknown as {
        __TAXLY_TEST_CALLS__: {
          name: string;
          args: Record<string, unknown>;
        }[];
      }
    ).__TAXLY_TEST_CALLS__;
    return calls.filter((call) => call.name === name).at(-1)?.args;
  }, name);
}
