import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorMessage, isDesktop, registerWebCommands } from "../api";
import { cloudTransport, makeClient, readConfig, saveConfig } from "./client";
import type { CloudClient, CloudConfig } from "./client";
import { initialStatus, SyncEngine } from "./engine";
import type { SyncStatus } from "./engine";
import { pendingCount } from "./model";
import { BrowserStore, NativeStore } from "./store";
import type { SyncStore } from "./store";
import { mobileCommands } from "./mobile";

interface Identity {
  id: string;
  email: string;
}
interface CloudContext {
  config: CloudConfig | null;
  client: CloudClient | null;
  identity: Identity | null;
  ready: boolean;
  loading: boolean;
  enabled: boolean;
  status: SyncStatus;
  recovery: boolean;
  localEntries: number;
  configure: (config: CloudConfig) => void;
  connect: () => Promise<void>;
  pause: () => Promise<void>;
  sync: () => void;
  resolve: (choices: Record<string, "local" | "remote">) => Promise<void>;
  finishRecovery: () => void;
}
const noop = async () => {};
const Context = createContext<CloudContext>({
  config: null,
  client: null,
  identity: null,
  ready: false,
  loading: false,
  enabled: false,
  status: initialStatus,
  recovery: false,
  localEntries: 0,
  configure: () => {},
  connect: noop,
  pause: noop,
  sync: () => {},
  resolve: noop,
  finishRecovery: () => {},
});
export const useCloud = () => useContext(Context);

export default function SyncProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(readConfig);
  const client = useMemo(() => (config ? makeClient(config) : null), [config]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(Boolean(client));
  const [enabled, setEnabled] = useState(false),
    [recovery, setRecovery] = useState(false),
    [localEntries, setLocalEntries] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(initialStatus);
  const [store, setStore] = useState<SyncStore | null>(null);
  const engine = useRef<SyncEngine | null>(null);
  useEffect(() => {
    if (!client || !config) return;
    let active = true;
    setLoading(true);
    const key = `taxly-last-owner:${config.url}`;
    const remember = (user: { id: string; email?: string }) => {
      const next = { id: user.id, email: user.email ?? "" };
      localStorage.setItem(key, JSON.stringify(next));
      setIdentity(next);
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session) remember(session.user);
      else if (event === "SIGNED_OUT") {
        localStorage.removeItem(key);
        setIdentity(null);
        setReady(false);
        registerWebCommands(null);
      }
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (data.session) remember(data.session.user);
        else if (!navigator.onLine) {
          try {
            const saved = JSON.parse(localStorage.getItem(key) ?? "null");
            if (saved?.id) setIdentity(saved);
          } catch {
            /* A corrupt hint cannot grant online access. */
          }
        } else if (error) setStatus({ ...initialStatus, phase: "error", message: error.message });
      })
      .catch((e) => {
        if (active) setStatus({ ...initialStatus, phase: "error", message: errorMessage(e) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
      void client.removeAllChannels();
    };
  }, [client, config]);
  useEffect(() => {
    let active = true;
    setReady(false);
    setStore(null);
    setEnabled(false);
    setStatus(initialStatus);
    registerWebCommands(null);
    if (!identity || !config) return;
    const next = isDesktop()
      ? new NativeStore(identity.id, config.url)
      : new BrowserStore(identity.id, config.url);
    void next
      .read()
      .then((state) => {
        if (!active) return;
        setStore(next);
        setEnabled(state.enabled);
        setLocalEntries(state.snapshot.entries.length);
        setStatus({
          ...initialStatus,
          phase: state.enabled ? "idle" : "paused",
          pending: pendingCount(state),
        });
        if (next instanceof BrowserStore) registerWebCommands(mobileCommands(next));
        setReady(true);
      })
      .catch((e) => {
        if (active) setStatus({ ...initialStatus, phase: "error", message: errorMessage(e) });
      });
    return () => {
      active = false;
      registerWebCommands(null);
    };
  }, [identity?.id, config]);
  useEffect(() => {
    if (!store || !client || !identity) return;
    const next = new SyncEngine(store, cloudTransport(client, identity.id), setStatus);
    engine.current = next;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void store
            .read()
            .then((state) => {
              if (!active) return;
              setEnabled(state.enabled);
              setLocalEntries(state.snapshot.entries.length);
              if (state.owner_id !== identity.id || state.project_url !== config?.url) {
                setStatus({
                  ...initialStatus,
                  phase: "error",
                  message: "ข้อมูลในเครื่องผูกกับบัญชีอื่น กรุณาเข้าสู่ระบบด้วยบัญชีเดิม",
                });
                return;
              }
              if (state.enabled) void next.run();
              else setStatus((old) => ({ ...old, phase: "paused", pending: pendingCount(state) }));
            })
            .catch((e) => {
              if (active)
                setStatus((old) => ({ ...old, phase: "error", message: errorMessage(e) }));
            }),
        150,
      );
    };
    const unsubscribe = enabled ? next.cloud.subscribe(update) : () => {};
    const interval = setInterval(update, 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    window.addEventListener("taxly-ledger-changed", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    update();
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
      next.stop();
      engine.current = null;
      window.removeEventListener("taxly-ledger-changed", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [store, client, identity?.id, enabled, config?.url]);
  const configure = (value: CloudConfig) => {
    if (identity) throw new Error("ออกจากระบบก่อนเปลี่ยนบริการซิงก์");
    setConfig(saveConfig(value));
  };
  const connect = async () => {
    if (!store) return;
    await store.bind(true);
    setEnabled(true);
  };
  const pause = async () => {
    if (!store) return;
    engine.current?.stop();
    await store.bind(false);
    setEnabled(false);
    setStatus((old) => ({ ...old, phase: "paused" }));
  };
  return (
    <Context.Provider
      value={{
        config,
        client,
        identity,
        ready,
        loading,
        enabled,
        status,
        recovery,
        localEntries,
        configure,
        connect,
        pause,
        sync: () => {
          void engine.current?.run();
        },
        resolve: async (choices) => {
          await engine.current?.resolve(choices);
        },
        finishRecovery: () => setRecovery(false),
      }}
    >
      {children}
    </Context.Provider>
  );
}
