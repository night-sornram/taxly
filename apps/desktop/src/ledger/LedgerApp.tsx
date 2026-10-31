import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  FileSpreadsheet,
  LayoutDashboard,
  ListOrdered,
  Plus,
  ShieldCheck,
  Tags,
  X,
  Cloud,
} from "lucide-react";
import { command, errorMessage, hasDataAccess } from "../api";
import SyncPage, { SyncBadge } from "../sync/SyncPage";
import { Button, ErrorNotice, Loading, PrivacyNote, SavedLabel, ThemeToggle } from "../components";
import ShellHeader from "../ShellHeader";
import EntryEditor, { todayIso } from "./EntryEditor";
import { CategoriesPage, EntriesPage, OverviewPage } from "./Pages";
import type { Ledger, LedgerEntry, LedgerKind } from "./types";
import "./ledger.css";

type View = "overview" | "entries" | "categories" | "import" | "privacy" | "sync";
const Privacy = lazy(() => import("../Privacy"));
const ImportPage = lazy(() => import("./ImportPage"));
const nav = [
  { id: "overview", label: "สรุปรายเดือน", icon: LayoutDashboard },
  { id: "entries", label: "รายการ", icon: ListOrdered },
  { id: "categories", label: "หมวดหมู่", icon: Tags },
  { id: "import", label: "นำเข้า CSV", icon: FileSpreadsheet },
  { id: "sync", label: "บัญชีและซิงก์", icon: Cloud },
] as const;

export default function LedgerApp({
  active,
  onSwitchArea,
  onTaxChanged,
  mobile = false,
}: {
  active: boolean;
  onSwitchArea: () => void;
  onTaxChanged: () => void;
  mobile?: boolean;
}) {
  const [view, setView] = useState<View>("overview");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editor, setEditor] = useState<{ entry: LedgerEntry | null; kind: LedgerKind }>();
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await command<Ledger>("get_ledger");
      if (request === generation.current) setLedger(next);
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    }
  }, []);
  // Reload whenever the area is shown: tax-side deletions can clear links.
  useEffect(() => {
    if (active && hasDataAccess()) void refresh();
  }, [active, refresh]);
  useEffect(() => {
    const updated = () => {
      if (active) void refresh();
    };
    window.addEventListener("taxly-ledger-refreshed", updated);
    return () => window.removeEventListener("taxly-ledger-refreshed", updated);
  }, [active, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (next: View) => {
    setView(next);
    setError("");
    window.scrollTo(0, 0);
  };
  const changed = async (taxChanged = false) => {
    await refresh();
    if (taxChanged) onTaxChanged();
    setToast(taxChanged ? "บันทึกแล้ว อัปเดตรายได้ในภาษีด้วย" : "บันทึกเรียบร้อย");
  };
  const add = (kind: LedgerKind) => setEditor({ entry: null, kind });

  if (!hasDataAccess()) return null;
  return (
    <div className="tx-app ledger-app">
      <a className="skip-link" href="#ledger-content">
        ข้ามไปเนื้อหาหลัก
      </a>
      <ShellHeader
        area="ledger"
        onSwitchArea={mobile ? undefined : onSwitchArea}
        tabs={nav}
        view={view}
        onNavigate={navigate}
        label="เมนูรายรับรายจ่าย"
      >
        <SyncBadge onOpen={() => navigate("sync")} />
        {!mobile && <SavedLabel />}
        <ThemeToggle />
        {!mobile && (
          <button
            className={`avatar ${view === "privacy" ? "active" : ""}`}
            aria-label="ข้อมูลของฉัน"
            aria-current={view === "privacy" ? "page" : undefined}
            onClick={() => navigate("privacy")}
          >
            <ShieldCheck size={19} />
          </button>
        )}
      </ShellHeader>
      <div className="main-shell">
        <main id="ledger-content" className="tx-main">
          {error && <ErrorNotice message={error} onClose={() => setError("")} />}
          <Suspense fallback={<Loading />}>
            {view === "sync" ? (
              <SyncPage />
            ) : view === "privacy" ? (
              <Privacy
                onRestored={async () => {
                  await refresh();
                  onTaxChanged();
                }}
                onSuccess={setToast}
              />
            ) : !ledger ? (
              error ? (
                <Button onClick={() => void refresh()}>ลองเปิดข้อมูลอีกครั้ง</Button>
              ) : (
                <Loading />
              )
            ) : (
              <>
                {view === "overview" && (
                  <OverviewPage ledger={ledger} month={month} onMonth={setMonth} onAdd={add} />
                )}
                {view === "entries" && (
                  <EntriesPage
                    ledger={ledger}
                    month={month}
                    onMonth={setMonth}
                    onAdd={add}
                    onEdit={(entry) => setEditor({ entry, kind: "expense" })}
                    onChanged={changed}
                  />
                )}
                {view === "categories" && <CategoriesPage ledger={ledger} onChanged={changed} />}
                {view === "import" && (
                  <ImportPage
                    ledger={ledger}
                    onImported={async (count) => {
                      await refresh();
                      setToast(`นำเข้า ${count} รายการแล้ว`);
                      navigate("entries");
                    }}
                  />
                )}
              </>
            )}
          </Suspense>
        </main>
        <footer className="app-footer">
          {mobile ? (
            <span>บันทึกในเครื่อง · ซิงก์ผ่านบัญชีของคุณเมื่อออนไลน์</span>
          ) : (
            <PrivacyNote />
          )}
        </footer>
      </div>
      {editor && ledger && (
        <EntryEditor
          key={editor.entry?.id ?? `new-${editor.kind}`}
          entry={editor.entry}
          initialKind={editor.kind}
          categories={ledger.categories}
          onClose={() => setEditor(undefined)}
          onSaved={changed}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={17} />
          <span>{toast}</span>
          <button aria-label="ปิดข้อความ" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <nav className="mobile-nav ledger-mobile-nav" aria-label="เมนูสำหรับหน้าจอเล็ก">
        {nav.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={19} />
            {item.label}
          </button>
        ))}
        <button aria-label="เพิ่มรายจ่าย" onClick={() => add("expense")}>
          <Plus size={20} />
        </button>
      </nav>
    </div>
  );
}
