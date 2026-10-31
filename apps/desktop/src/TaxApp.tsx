import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FileClock,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { command, errorMessage, isDesktop } from "./api";
import {
  Brand,
  Button,
  ErrorNotice,
  Loading,
  Modal,
  PrivacyNote,
  SavedLabel,
  ThemeToggle,
} from "./components";
import type {
  Calculation,
  Deduction,
  Guidance,
  Income,
  RuleSource,
  Snapshot,
  Workspace,
} from "./types";
import Dashboard from "./Dashboard";
import Onboarding from "./Onboarding";
import { IncomeEditor, IncomePage, DeductionEditor } from "./Income";
import { DeductionsPage, Explanation, HistoryPage, ProfileEditor } from "./Details";
import Privacy from "./Privacy";
import AreaSwitcher from "./AreaSwitcher";
import ShellHeader from "./ShellHeader";

type View = "dashboard" | "income" | "deductions" | "explanation" | "history" | "privacy";
const nav = [
  { id: "dashboard", label: "ภาพรวมภาษี", icon: LayoutDashboard },
  { id: "income", label: "รายได้ของฉัน", icon: Wallet },
  { id: "deductions", label: "สิทธิ์ลดหย่อน", icon: Leaf },
] as const;
const additionalNav = [
  { id: "explanation", label: "เข้าใจการคำนวณ", icon: BookOpen },
  { id: "history", label: "ผลสรุปที่บันทึก", icon: FileClock },
] as const;

export default function TaxApp({
  onSwitchArea,
  dataVersion,
}: {
  onSwitchArea: () => void;
  /** Bumped when another area changed tax data (e.g. a linked ledger income). */
  dataVersion: number;
}) {
  const [year, setYear] = useState(2026);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [sources, setSources] = useState<RuleSource[]>([]);
  const [guidance, setGuidance] = useState<Guidance[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [incomeEditor, setIncomeEditor] = useState<Income | null | undefined>(undefined);
  const [deductionEditor, setDeductionEditor] = useState<Deduction | null | undefined>(undefined);
  const [profileEditor, setProfileEditor] = useState(false);
  const [archived, setArchived] = useState<Snapshot | null>(null);
  const generation = useRef(0);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!isDesktop()) {
      setPreferencesReady(true);
      return;
    }
    void command<number>("get_active_tax_year")
      .then((selected) => {
        if (!cancelled) {
          setYear(selected);
          setPreferencesReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(errorMessage(error));
          setPreferencesReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++generation.current;
    setError("");
    try {
      const data = await command<Workspace>("get_year_workspace", { year });
      const [rules, result, cards, snapshots] = await Promise.all([
        command<RuleSource[]>("get_rule_sources", { year }),
        data.profile ? command<Calculation>("calculate_year", { year }) : Promise.resolve(null),
        data.profile
          ? command<Guidance[]>("get_deduction_guidance", { year })
          : Promise.resolve([]),
        data.profile ? command<Snapshot[]>("get_history", { year }) : Promise.resolve([]),
      ]);
      if (sequence !== generation.current) return;
      setWorkspace(data);
      setSources(rules);
      setCalculation(result);
      setGuidance(cards);
      setHistory(snapshots);
    } catch (e) {
      if (sequence === generation.current) setError(errorMessage(e));
      throw e;
    } finally {
      if (sequence === generation.current) setLoading(false);
    }
  }, [year]);
  useEffect(() => {
    if (!preferencesReady) return;
    if (!isDesktop()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setWorkspace(null);
    setCalculation(null);
    void refresh().catch(() => {});
    return () => {
      generation.current++;
    };
  }, [refresh, preferencesReady]);
  useEffect(() => {
    if (dataVersion > 0) void refresh().catch(() => {});
  }, [dataVersion]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const hasProfile = Boolean(workspace?.profile);
  useEffect(() => {
    main.current?.querySelector<HTMLHeadingElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view, hasProfile]);
  const navigate = (next: View) => {
    setView(next);
    setError("");
    window.scrollTo(0, 0);
  };
  const changed = async () => {
    await refresh();
    setToast("บันทึกเรียบร้อย คำนวณใหม่แล้ว");
  };
  const source = async (id: string) => {
    try {
      await command("open_source", { year, sourceId: id });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const saveSnapshot = async () => {
    setSaving(true);
    try {
      await command("save_snapshot", { year });
      await refresh();
      setToast("บันทึกผลสรุปพร้อมข้อมูลและชุดกฎแล้ว");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const switchYear = async (next: number) => {
    try {
      await command("set_active_tax_year", { year: next });
    } catch (error) {
      setError(errorMessage(error));
      return;
    }
    setIncomeEditor(undefined);
    setDeductionEditor(undefined);
    setProfileEditor(false);
    setArchived(null);
    setView("dashboard");
    setYear(next);
  };

  if (!isDesktop())
    return (
      <div className="browser-gate">
        <Brand />
        <div className="card">
          <span className="welcome-symbol">
            <LockKeyhole size={38} />
          </span>
          <h1>เรื่องภาษี อยู่ในเครื่องของคุณ</h1>
          <p>Taxly เป็นแอปเดสก์ท็อป กรุณาเปิดแอปเพื่อเริ่มบันทึกและประมาณการภาษี</p>
          <code>
            cd apps/desktop
            <br />
            npm run tauri dev
          </code>
          <PrivacyNote />
        </div>
      </div>
    );
  if (loading && !workspace)
    return (
      <div className="initial-loading">
        <Brand />
        <Loading />
      </div>
    );
  if (!workspace)
    return (
      <div className="initial-loading">
        <Brand />
        {error && <ErrorNotice message={error} />}
        <Button onClick={() => void refresh().catch(() => {})}>ลองเปิดข้อมูลอีกครั้ง</Button>
      </div>
    );
  if (!workspace.profile && view !== "privacy")
    return (
      <>
        <Onboarding
          key={year}
          year={year}
          draft={workspace.draft}
          onComplete={async () => {
            setView("dashboard");
            await refresh();
          }}
        />
        <nav className="onboarding-utility" aria-label="ส่วนการใช้งานและปีภาษี">
          <AreaSwitcher area="tax" onSwitch={onSwitchArea} />
          <label>
            ปีภาษี{" "}
            <select
              aria-label="เปลี่ยนปีภาษี"
              value={year}
              onChange={(e) => switchYear(Number(e.target.value))}
            >
              <option value={2026}>2569</option>
              <option value={2025}>2568</option>
            </select>
          </label>
          <button onClick={() => setView("privacy")}>สำรอง / กู้คืนข้อมูล</button>
        </nav>
      </>
    );

  return (
    <div className="tx-app">
      <a className="skip-link" href="#main-content">
        ข้ามไปเนื้อหาหลัก
      </a>
      <ShellHeader
        area="tax"
        onSwitchArea={onSwitchArea}
        tabs={[...nav, ...additionalNav]}
        view={view}
        onNavigate={navigate}
        label="เมนูหลัก"
      >
        <SavedLabel />
        <label className="year-picker">
          <span>ปีภาษี</span>
          <select
            aria-label="ปีภาษี"
            value={year}
            onChange={(e) => switchYear(Number(e.target.value))}
          >
            <option value={2026}>2569</option>
            <option value={2025}>2568</option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
        <ThemeToggle />
        <button
          className={`avatar ${view === "privacy" ? "active" : ""}`}
          aria-label="ข้อมูลของฉัน"
          aria-current={view === "privacy" ? "page" : undefined}
          onClick={() => navigate("privacy")}
        >
          <ShieldCheck size={19} />
        </button>
      </ShellHeader>
      <div className="main-shell">
        <main id="main-content" ref={main} className="tx-main">
          {error && <ErrorNotice message={error} onClose={() => setError("")} />}
          {view === "privacy" ? (
            <Privacy onRestored={refresh} onSuccess={setToast} />
          ) : !workspace.profile ? (
            <div className="empty-state">
              <h1 tabIndex={-1}>เริ่มปีภาษี {year + 543}</h1>
              <Button onClick={() => navigate("dashboard")}>เริ่มต้นข้อมูลปีนี้</Button>
            </div>
          ) : (
            calculation && (
              <>
                {view === "dashboard" && (
                  <Dashboard
                    data={calculation}
                    workspace={workspace}
                    onNavigate={navigate}
                    onAdd={() => setIncomeEditor(null)}
                    onSave={() => void saveSnapshot()}
                    saving={saving}
                  />
                )}
                {view === "income" && (
                  <IncomePage
                    workspace={workspace}
                    onEdit={setIncomeEditor}
                    onChanged={changed}
                    onProfile={() => setProfileEditor(true)}
                  />
                )}
                {view === "deductions" && (
                  <DeductionsPage
                    workspace={workspace}
                    guidance={guidance}
                    onEdit={setDeductionEditor}
                    onChanged={changed}
                    onProfile={() => setProfileEditor(true)}
                    onSource={(id) => void source(id)}
                  />
                )}
                {view === "explanation" && (
                  <Explanation
                    data={calculation}
                    sources={sources}
                    onSource={(id) => void source(id)}
                  />
                )}
                {view === "history" && (
                  <HistoryPage
                    history={history}
                    revision={workspace.profile.revision}
                    onSave={() => void saveSnapshot()}
                    onView={setArchived}
                  />
                )}
              </>
            )
          )}
        </main>
        <footer className="app-footer">
          <PrivacyNote />
          <span>คำนวณเพื่อประมาณการ · ไม่ใช่การยื่นแบบภาษี</span>
        </footer>
      </div>
      {incomeEditor !== undefined && (
        <IncomeEditor
          key={incomeEditor?.id ?? "new"}
          entry={incomeEditor}
          workspace={workspace}
          onClose={() => setIncomeEditor(undefined)}
          onSaved={changed}
        />
      )}
      {deductionEditor !== undefined && (
        <DeductionEditor
          key={deductionEditor?.id ?? "new"}
          entry={deductionEditor}
          year={year}
          onClose={() => setDeductionEditor(undefined)}
          onSaved={changed}
        />
      )}
      {profileEditor && workspace.profile && (
        <ProfileEditor
          workspace={workspace}
          onClose={() => setProfileEditor(false)}
          onSaved={changed}
        />
      )}
      {archived && (
        <Modal title="ผลสรุปที่เคยบันทึก" onClose={() => setArchived(null)}>
          <Explanation
            data={JSON.parse(archived.result_json) as Calculation}
            sources={sources}
            onSource={(id) => void source(id)}
            archived
          />
        </Modal>
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
      <nav className="mobile-nav" aria-label="เมนูสำหรับหน้าจอเล็ก">
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
        <button
          className={view === "privacy" ? "active" : ""}
          aria-current={view === "privacy" ? "page" : undefined}
          onClick={() => navigate("privacy")}
        >
          <ShieldCheck size={19} />
          ข้อมูลของฉัน
        </button>
        <button aria-label="เพิ่มรายได้" onClick={() => setIncomeEditor(null)}>
          <Plus size={20} />
        </button>
      </nav>
    </div>
  );
}
