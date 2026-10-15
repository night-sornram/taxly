import { invoke } from "@tauri-apps/api/core";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop())
    throw {
      code: "DesktopRequired",
      message: "กรุณาเปิด Taxly บนเดสก์ท็อปเพื่อใช้งานข้อมูลในเครื่อง",
    };
  return invoke<T>(name, args);
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
