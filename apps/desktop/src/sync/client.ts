import { createClient } from "@supabase/supabase-js";
import { validateSnapshot } from "./model";
import type { CloudTransport } from "./engine";
import type { Snapshot } from "./model";
export interface CloudConfig {
  url: string;
  key: string;
  webUrl: string;
}
const configKey = "taxly-cloud-config";
export function validateConfig(value: CloudConfig): CloudConfig {
  const url = value.url.trim().replace(/\/$/, ""),
    key = value.key.trim(),
    webUrl = value.webUrl.trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    throw new Error("กรอก Project URL แบบ https://ชื่อโปรเจกต์.supabase.co");
  let publicKey = key.startsWith("sb_publishable_") && key.length >= 30;
  if (key.startsWith("eyJ")) {
    try {
      const part = key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
      publicKey = JSON.parse(atob(part)).role === "anon";
    } catch {
      publicKey = false;
    }
  }
  if (!publicKey)
    throw new Error(
      "ใช้เฉพาะ publishable key หรือ anon key ห้ามใช้ secret key หรือ service_role key",
    );
  if (webUrl && !/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9/_-]*)?$/i.test(webUrl))
    throw new Error("ที่อยู่เว็บมือถือควรเป็น HTTPS");
  return { url, key, webUrl };
}
export function readConfig(): CloudConfig | null {
  try {
    const env = import.meta.env;
    const stored = localStorage.getItem(configKey);
    return validateConfig(
      env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
        ? {
            url: env.VITE_SUPABASE_URL,
            key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
            webUrl: env.VITE_TAXLY_WEB_URL ?? "",
          }
        : stored
          ? JSON.parse(stored)
          : { url: "", key: "", webUrl: "" },
    );
  } catch {
    return null;
  }
}
export function saveConfig(value: CloudConfig) {
  const config = validateConfig(value);
  localStorage.setItem(configKey, JSON.stringify(config));
  return config;
}
function newClient(config: CloudConfig) {
  return createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !("__TAURI_INTERNALS__" in window),
    },
  });
}
let sharedClient: { url: string; key: string; client: ReturnType<typeof newClient> } | undefined;
export function makeClient(config: CloudConfig) {
  if (sharedClient?.url === config.url && sharedClient.key === config.key)
    return sharedClient.client;
  const client = newClient(config);
  sharedClient = { url: config.url, key: config.key, client };
  return client;
}
export type CloudClient = ReturnType<typeof makeClient>;
export function cloudTransport(client: CloudClient, owner: string): CloudTransport {
  return {
    async read() {
      const { data, error } = await client.rpc("taxly_get_ledger");
      if (error) throw error;
      return { revision: data.revision, snapshot: validateSnapshot(data.snapshot) };
    },
    async write(expected: number, snapshot: Snapshot, operationId: string) {
      const { data, error } = await client.rpc("taxly_put_ledger", {
        expected_revision: expected,
        next_snapshot: snapshot,
        operation_id: operationId,
      });
      if (error) throw error;
      return data as number;
    },
    subscribe(changed) {
      const channel = client
        .channel(`ledger:${owner}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "taxly_sync_heads",
            filter: `owner_id=eq.${owner}`,
          },
          changed,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") changed();
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
