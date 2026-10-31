import { invoke } from "@tauri-apps/api/core";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;
type WebCommand = (name: string, args: Record<string, unknown>) => Promise<unknown>;
let webCommand: WebCommand | null = null;
export function registerWebCommands(handler: WebCommand | null) {
  webCommand = handler;
}
export const hasDataAccess = () => isDesktop() || webCommand !== null;

export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop() && webCommand) return webCommand(name, args ?? {}) as Promise<T>;
  if (!isDesktop())
    throw {
      code: "DesktopRequired",
      message: "กรุณาเปิด Taxly บนเดสก์ท็อปเพื่อใช้งานข้อมูลในเครื่อง",
    };
  const result = await invoke<T>(name, args);
  if (
    [
      "save_ledger_entry",
      "delete_ledger_entry",
      "save_ledger_category",
      "delete_ledger_category",
      "import_ledger_entries",
      "upsert_income",
      "delete_income",
      "save_onboarding",
      "save_profile",
      "upsert_deduction",
      "delete_deduction",
      "restore_backup",
      "delete_all_data",
    ].includes(name)
  )
    window.dispatchEvent(new Event("taxly-ledger-changed"));
  return result;
}

export function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง";
}
export function isCancelled(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "Cancelled"
  );
}
