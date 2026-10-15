import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installIpc } from "./ipc";
import type { WealthWorkspace } from "../src/wealth/types";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/wealth-contract.json", import.meta.url), "utf8"),
) as { full: WealthWorkspace; empty: WealthWorkspace };

/** UI adapter only: calculated values come from the reviewed Rust fixture. */
export async function installWealthIpc(page: Page, empty = false) {
  await installIpc(page);
  await page.addInitScript(
    ({ fixtures, empty }) => {
      const current = structuredClone(empty ? fixtures.empty : fixtures.full);
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internal.invoke;
      const calls = (
        window as unknown as {
          __TAXLY_TEST_CALLS__: { name: string; args: Record<string, unknown> }[];
        }
      ).__TAXLY_TEST_CALLS__;
      internal.invoke = async (name, args = {}) => {
        if (!name.includes("wealth")) return original(name, args);
        calls.push({ name, args });
        switch (name) {
          case "get_wealth_workspace": {
            const result = structuredClone(current);
            const filter = args.filter as { account_ids: string[] };
            result.portfolio.accounts = result.data.accounts
              .filter((a) => !filter.account_ids.length || filter.account_ids.includes(a.id))
              .map((a) => ({
                id: a.id,
                value: current.portfolio.accounts.find((r) => r.id === a.id)?.value ?? null,
              }));
            return result;
          }
          case "save_wealth_account": {
            const row = args.account as WealthWorkspace["data"]["accounts"][number];
            const index = current.data.accounts.findIndex((a) => a.id === row.id);
            if (index < 0) current.data.accounts.push(row);
            else current.data.accounts[index] = row;
            return null;
          }
          case "save_wealth_opening":
            current.data.opening_positions.push(
              args.opening as WealthWorkspace["data"]["opening_positions"][number],
            );
            return null;
          case "save_wealth_activity":
            current.data.activities.push(
              args.activity as WealthWorkspace["data"]["activities"][number],
            );
            return null;
          case "save_wealth_instrument":
            current.data.instruments.push(
              args.instrument as WealthWorkspace["data"]["instruments"][number],
            );
            return null;
          case "search_wealth_instruments": {
            const query = String(args.query ?? "").toLowerCase();
            if (!current.data.preferences.market_data_enabled)
              throw { message: "เปิดใช้ข้อมูลตลาดในตั้งค่าการลงทุนก่อนค้นหา" };
            const catalog = [
              {
                symbol: "PTT.BK",
                name: "ปตท. (PTT PCL)",
                exchange: "SET",
                kind: "stock",
                currency: "THB",
              },
              {
                symbol: "VOO",
                name: "Vanguard S&P 500 ETF",
                exchange: "SNP",
                kind: "etf",
                currency: "USD",
              },
            ];
            return catalog.filter((item) => item.symbol.toLowerCase().includes(query));
          }
          case "save_wealth_preferences":
            current.data.preferences = args.preferences as WealthWorkspace["data"]["preferences"];
            return null;
          case "save_wealth_price":
            current.data.prices.push(args.price as WealthWorkspace["data"]["prices"][number]);
            return null;
          case "save_wealth_fx":
            current.data.fx_rates.push(args.rate as WealthWorkspace["data"]["fx_rates"][number]);
            return null;
          case "refresh_wealth_market_data":
            return {
              updated_prices: 0,
              updated_fx: 0,
              failures: ["Yahoo Finance จำกัดจำนวนคำขอ โปรดลองภายหลัง"],
            };
          case "cancel_wealth_import":
            return null;
          case "save_wealth_template":
            return null;
          case "preview_wealth_import": {
            const activity = {
              ...fixtures.full.data.activities[1],
              id: "csv-buy",
              date: "2026-01-03",
              quantity: "0.25",
              unit_price: "100",
              amount: "25",
              fee: "0",
              tax: "0",
            };
            return {
              token: "review-token",
              revision: current.data.revision,
              filename: "broker.csv",
              headers: ["date", "kind", "symbol", "currency", "quantity", "unit_price", "amount"],
              mapping: {
                date: "date",
                kind: "kind",
                symbol: "symbol",
                currency: "currency",
                quantity: "quantity",
                unit_price: "unit_price",
                amount: "amount",
              },
              mode: "activities",
              account_id: "account-thb",
              new_instruments: [],
              rows: [
                {
                  index: 1,
                  values: {
                    date: "2026-01-03",
                    kind: "buy",
                    symbol: "PTT",
                    currency: "THB",
                    quantity: "0.25",
                    unit_price: "100",
                    amount: "25",
                  },
                  activity,
                  opening: null,
                  errors: [],
                  duplicate: false,
                },
                {
                  index: 2,
                  values: {
                    date: "2026-01-01",
                    kind: "buy",
                    symbol: "PTT",
                    currency: "THB",
                    quantity: "10",
                    unit_price: "100",
                    amount: "1010",
                  },
                  activity: fixtures.full.data.activities[1],
                  opening: null,
                  errors: [],
                  duplicate: true,
                },
              ],
            };
          }
          case "commit_wealth_import":
            return {
              imported: (args.includeRows as number[]).length,
              skipped: 2 - (args.includeRows as number[]).length,
            };
          default:
            throw { message: `Unexpected wealth UI command: ${name}` };
        }
      };
    },
    { fixtures, empty },
  );
}

export async function openWealth(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "การลงทุนของฉัน", exact: true }).click();
  await page.getByRole("heading", { name: "ภาพรวมการลงทุน", exact: true }).waitFor();
}
