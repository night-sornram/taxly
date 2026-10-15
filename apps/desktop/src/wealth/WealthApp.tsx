import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  FileSpreadsheet,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { command, errorMessage } from "../api";
import {
  Brand,
  Button,
  ErrorNotice,
  Loading,
  PrivacyNote,
  SavedLabel,
  ThemeToggle,
} from "../components";
import Privacy from "../Privacy";
import AreaSwitcher from "../AreaSwitcher";
import EditorModal from "./Editors";
import type { Editor } from "./Editors";
import Overview from "./Overview";
import ImportPage from "./ImportPage";
import { AccountsPage, ActivityPage, DeleteConfirmation, HoldingsPage, MarketPage } from "./Pages";
import { today } from "./format";
import type { PortfolioFilter, WealthWorkspace } from "./types";
import "./wealth.css";

type View = "overview" | "accounts" | "holdings" | "activity" | "import" | "market" | "privacy";
const navigation = [
  { id: "overview", label: "ภาพรวม", icon: LayoutDashboard },
  { id: "accounts", label: "บัญชี", icon: Wallet },
  { id: "holdings", label: "หลักทรัพย์ในพอร์ต", icon: BriefcaseBusiness },
  { id: "activity", label: "รายการลงทุน", icon: Activity },
  { id: "import", label: "นำเข้าข้อมูล", icon: FileSpreadsheet },
  { id: "market", label: "ราคาและอัตราแลกเปลี่ยน", icon: ChartNoAxesCombined },
] as const;
export default function WealthApp({ onTaxes }: { onTaxes: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [workspace, setWorkspace] = useState<WealthWorkspace | null>(null);
  const [filter, setFilter] = useState<PortfolioFilter>({
    account_ids: [],
    start_date: null,
    end_date: today(),
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "activity" | "opening"; id: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const main = useRef<HTMLElement>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await command<WealthWorkspace>("get_wealth_workspace", { filter });
      if (request === generation.current) setWorkspace(next);
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
      throw e;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    void refresh().catch(() => {});
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    main.current?.querySelector<HTMLHeadingElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const changed = async () => {
    await refresh();
    setToast("บันทึกเรียบร้อย พอร์ตอัปเดตแล้ว");
  };
  const navigate = (next: View) => {
    setView(next);
    setError("");
  };
  const edit = (next: Editor) => {
    setError("");
    setEditor(next);
  };
  const deleteEntry = async () => {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await command(`delete_wealth_${deleting.kind}`, { id: deleting.id });
      await changed();
      setDeleting(null);
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };
  const currentLabel = navigation.find((n) => n.id === view)?.label ?? "ข้อมูลของฉัน";
  const filtered = ["overview", "holdings", "activity", "accounts"].includes(view);
  return (
    <div className="app-shell wealth-shell">
      <a className="skip-link" href="#wealth-main">
        ข้ามไปเนื้อหาหลัก
      </a>
      <aside className="sidebar">
        <Brand />
        <AreaSwitcher area="wealth" onSwitch={onTaxes} />
        <div className="sidebar-section-label">จัดการการลงทุน</div>
        <nav aria-label="เมนูการลงทุน">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {view === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <nav aria-label="การตั้งค่าร่วม">
          <button
            onClick={() => navigate("privacy")}
            className={view === "privacy" ? "active" : ""}
            aria-current={view === "privacy" ? "page" : undefined}
          >
            <ShieldCheck size={18} />
            ข้อมูลของฉัน
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="wealth-local-card">
            <span aria-hidden="true">✳</span>
            <h3>
              ข้อมูลการลงทุน
              <br />
              เก็บไว้ในเครื่องของคุณ
            </h3>
            <p>
              ไม่ต้องสมัครบัญชี
              <br />
              เปิดดูได้แม้ออฟไลน์
            </p>
          </div>
          <div className="local-status">
            <span />
            เก็บข้อมูลในเครื่อง <LockKeyhole size={12} />
          </div>
          <small>Taxly · การลงทุนและภาษี</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            การลงทุน <ChevronRight size={13} />
            <strong>{currentLabel}</strong>
          </div>
          <div className="topbar-right">
            <SavedLabel />
            <ThemeToggle />
            <button
              className="avatar"
              aria-label="ข้อมูลของฉัน"
              onClick={() => navigate("privacy")}
            >
              <ShieldCheck size={18} />
            </button>
          </div>
        </header>
        <nav className="mobile-area-switcher" aria-label="สลับส่วนการใช้งาน">
          <AreaSwitcher area="wealth" onSwitch={onTaxes} />
        </nav>
        <main
          id="wealth-main"
          ref={main}
          className="main-content wealth-content"
          aria-busy={loading}
        >
          {filtered && workspace && (
            <form
              className="wealth-filter-bar"
              onSubmit={(e) => {
                e.preventDefault();
                setFilter({ ...filter, start_date: startDate || null, end_date: endDate });
              }}
            >
              <label>
                <Wallet size={15} />
                <span className="sr-only">กรองตามบัญชี</span>
                <select
                  aria-label="กรองตามบัญชี"
                  value={filter.account_ids[0] ?? ""}
                  disabled={loading}
                  onChange={(e) =>
                    setFilter({ ...filter, account_ids: e.target.value ? [e.target.value] : [] })
                  }
                >
                  <option value="">ทุกบัญชี</option>
                  {workspace.data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="wealth-date-filter">
                <label>
                  ตั้งแต่
                  <input
                    aria-label="วันที่เริ่มช่วง (ค.ศ.)"
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <span>—</span>
                <label>
                  ถึง
                  <input
                    aria-label="วันที่สิ้นสุดช่วง (ค.ศ.)"
                    type="date"
                    required
                    value={endDate}
                    min={startDate}
                    max={today()}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <Button variant="secondary" type="submit" disabled={loading}>
                  ใช้ช่วงวันที่
                </Button>
              </div>
              {loading && (
                <span className="wealth-filter-loading" role="status">
                  กำลังคำนวณ…
                </span>
              )}
            </form>
          )}
          {error && <ErrorNotice message={error} onClose={() => setError("")} />}
          {!workspace ? (
            <div className="wealth-initial">
              {loading ? (
                <Loading label="กำลังโหลดพอร์ต…" />
              ) : (
                <>
                  <h1 tabIndex={-1}>เปิดข้อมูลการลงทุนไม่สำเร็จ</h1>
                  <Button onClick={() => void refresh().catch(() => {})}>ลองอีกครั้ง</Button>
                </>
              )}
            </div>
          ) : (
            <>
              {filtered && workspace.portfolio.warnings.length > 0 && (
                <details className="wealth-quality-warning" open>
                  <summary>
                    ข้อมูลบางรายการยังไม่ครบ ({workspace.portfolio.warnings.length})
                  </summary>
                  <ul>
                    {workspace.portfolio.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                  <button className="wealth-inline-link" onClick={() => navigate("market")}>
                    ไปดูราคาและอัตราแลกเปลี่ยน <ChevronRight size={14} />
                  </button>
                </details>
              )}
              <div className={loading ? "wealth-stale-content" : ""} inert={loading || undefined}>
                {view === "overview" && (
                  <Overview
                    workspace={workspace}
                    onAccount={() => edit({ kind: "account" })}
                    onActivity={() => edit({ kind: "activity" })}
                    onOpening={() => edit({ kind: "opening" })}
                    onImport={() => navigate("import")}
                    onHoldings={() => navigate("holdings")}
                  />
                )}
                {view === "accounts" && (
                  <AccountsPage
                    workspace={workspace}
                    edit={edit}
                    onDelete={(kind, id) => setDeleting({ kind, id })}
                  />
                )}
                {view === "holdings" && <HoldingsPage workspace={workspace} edit={edit} />}
                {view === "activity" && (
                  <ActivityPage
                    workspace={workspace}
                    edit={edit}
                    onDelete={(kind, id) => setDeleting({ kind, id })}
                    onAccount={() => edit({ kind: "account" })}
                    onImport={() => navigate("import")}
                  />
                )}
                {view === "import" && (
                  <ImportPage
                    data={workspace.data}
                    onChanged={changed}
                    onAccount={() => edit({ kind: "account" })}
                  />
                )}
                {view === "market" && (
                  <MarketPage
                    key={workspace.data.preferences.reporting_currency}
                    workspace={workspace}
                    edit={edit}
                    onChanged={changed}
                  />
                )}
                {view === "privacy" && <Privacy onRestored={refresh} onSuccess={setToast} />}
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <PrivacyNote />
          <span>ผลการลงทุนไม่นำไปคำนวณภาษีในแอปนี้</span>
        </footer>
      </div>
      {editor && workspace && (
        <EditorModal
          editor={editor}
          data={workspace.data}
          onClose={() => setEditor(null)}
          onSaved={changed}
        />
      )}
      {deleting && (
        <DeleteConfirmation
          kind={deleting.kind}
          busy={busy}
          onClose={() => setDeleting(null)}
          onDelete={() => void deleteEntry()}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="ปิดข้อความ" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <nav className="wealth-mobile-nav" aria-label="เมนูหน้าจอเล็ก">
        <select
          aria-label="เลือกหน้าการลงทุน"
          value={view}
          onChange={(e) => navigate(e.target.value as View)}
        >
          {navigation.map((n) => (
            <option value={n.id} key={n.id}>
              {n.label}
            </option>
          ))}
          <option value="privacy">ข้อมูลของฉัน</option>
        </select>
        {workspace && (
          <button
            aria-label="เพิ่มรายการลงทุน"
            onClick={() =>
              edit(workspace.data.accounts.length ? { kind: "activity" } : { kind: "account" })
            }
          >
            <Plus size={20} />
          </button>
        )}
      </nav>
    </div>
  );
}
