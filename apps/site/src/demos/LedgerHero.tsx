import { Bus, ChevronLeft, ChevronRight, Cloud, FileSpreadsheet, LayoutDashboard, ListOrdered, Plus, Tags, Utensils, Zap, type LucideIcon } from "lucide-react";
import { Bar, Collapse, Count, Field, Popover, Stage, Text, Window, type Act, type Layout } from "../kit";
import "./look.css";
import "./hero.css";

// The landing hero (corner bleed, after the stageshow hero-demo): Taxly's
// ledger for October. The cursor adds a 185-baht lunch; the row lands at the
// top of the list and the expense and balance pockets roll a beat later.
// Plays once as it comes into view and holds the payoff; Replay remounts it.

type S = {
  open: boolean;
  amount: string;
  note: string;
  focus: "amount" | "note" | null;
  added: boolean;
  spent: number;
};

const SPENT = 12430;
const INCOME = 42000;
const LUNCH = 185;
const EDITOR = { wide: 264, compact: 248 };

const initial: S = { open: false, amount: "", note: "", focus: null, added: false, spent: SPENT };
const poster: S = { ...initial, added: true, spent: SPENT + LUNCH };

const baht = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REST = { wide: { x: 650, y: 100 }, compact: { x: 320, y: 92 } };

async function script(a: Act<S>) {
  await a.wait(700);
  await a.move({ at: "add", x: 0.85, y: 0.6 });
  await a.wait(200);
  await a.click();
  await a.set({ open: true, focus: "amount" });
  a.mark("open");
  await a.wait(500);
  await a.type("amount", String(LUNCH));
  await a.wait(300);
  await a.click({ at: "note", x: 0.8, y: 0.5 });
  await a.set({ focus: "note" });
  await a.type("note", "ข้าวมันไก่");
  await a.wait(500);
  await a.move({ at: "save", x: 0.8, y: 0.6 });
  await a.wait(150);
  await a.click();
  // The editor closes, then the row arrives; the totals follow their cause.
  await a.set({ focus: null });
  await a.set({ open: false });
  await a.wait(120);
  await a.set({ added: true });
  await a.wait(450);
  await a.set({ spent: SPENT + LUNCH });
  await a.move("rest");
}

const NAV: [LucideIcon, number][] = [
  [LayoutDashboard, 58],
  [ListOrdered, 34],
  [Tags, 44],
  [FileSpreadsheet, 52],
  [Cloud, 64],
];

function Sidebar() {
  return (
    <nav className="lh-side">
      {NAV.map(([Glyph, w], i) => (
        <span key={i} className="lh-nav" data-active={i === 1 || undefined}>
          <Glyph size={16} strokeWidth={1.75} />
          <Bar w={w} h={6} tone={i === 1 ? 4 : 2} />
        </span>
      ))}
    </nav>
  );
}

function Pocket({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <div className="lh-pocket" data-tone={tone}>
      <Text className="lh-pocket-label">{label}</Text>
      <span className="lh-pocket-value tx-num">
        <Count value={value} format={baht} duration={900} />
        <span className="lh-unit">บาท</span>
      </span>
    </div>
  );
}

function Entry({ icon: Glyph, tone, title, sub, amount }: { icon: LucideIcon; tone: string; title: string; sub: string; amount: number }) {
  return (
    <div className="lh-row">
      <span className="tx-cat" data-tone={tone}>
        <Glyph size={16} strokeWidth={1.75} />
      </span>
      <span className="lh-row-text">
        <Text className="lh-row-title">{title}</Text>
        <Text className="lh-row-sub">{sub}</Text>
      </span>
      <Text className="lh-row-amount tx-num">{`−${baht(amount)}`}</Text>
    </div>
  );
}

function Filler({ w, amount }: { w: number; amount: number }) {
  return (
    <div className="lh-row">
      <Bar w={32} h={32} r={16} tone={1} />
      <span className="lh-row-text">
        <Bar w={w} h={7} tone={3} />
        <Bar w={w - 22} h={6} tone={2} />
      </span>
      <Bar w={amount} h={7} tone={3} className="lh-row-amount" />
    </div>
  );
}

function Ledger({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  return (
    <div className="lh-body">
      <div className="lh-actions">
        <span className="lh-month">
          <ChevronLeft size={16} strokeWidth={1.75} />
          <Text>ตุลาคม 2569</Text>
          <ChevronRight size={16} strokeWidth={1.75} />
        </span>
        {wide && (
          <span className="lh-btn">
            <Plus size={16} strokeWidth={2} />
            รายรับ
          </span>
        )}
        <span className="lh-btn lh-btn--primary" data-target="add" data-open={s.open || undefined}>
          <Plus size={16} strokeWidth={2} />
          รายจ่าย
        </span>
      </div>
      <div className="lh-pockets">
        {wide && <Pocket tone="mint" label="รายรับ" value={INCOME} />}
        <Pocket tone="peach" label="รายจ่าย" value={s.spent} />
        <Pocket tone="lilac" label="คงเหลือ" value={INCOME - s.spent} />
      </div>
      <div className="lh-list">
        <Collapse open={s.added} reveal="drop">
          <Entry icon={Utensils} tone="peach" title="ข้าวมันไก่" sub="อาหารและเครื่องดื่ม · วันนี้" amount={LUNCH} />
        </Collapse>
        <Entry icon={Bus} tone="sky" title="ค่ารถไฟฟ้า" sub="เดินทาง · 28 ต.ค." amount={64} />
        <Entry icon={Zap} tone="lemon" title="ค่าไฟ" sub="ค่าน้ำ ค่าไฟ ค่าโทรศัพท์ · 27 ต.ค." amount={1280} />
        <Filler w={88} amount={52} />
        <Filler w={64} amount={44} />
      </div>
    </div>
  );
}

export function LedgerHero() {
  return (
    <Stage<S>
      width={720}
      height={360}
      compact={{ below: 600, width: 358, height: 320 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: REST }}
      greys="cool"
      className="tx-look lh"
    >
      {(s, rect, layout) => (
        <>
          {layout === "wide" ? (
            <Window className="lh-window" title="รายการ" sidebar={<Sidebar />} sidebarWidth={168}>
              <Ledger s={s} layout={layout} />
            </Window>
          ) : (
            <Window className="lh-window" title="รายการ">
              <Ledger s={s} layout={layout} />
            </Window>
          )}

          <Popover show={s.open} origin="top right" className="lh-editor" style={{ left: rect("add").x + rect("add").width - EDITOR[layout], top: rect("add").y + rect("add").height + 8 }}>
            <div className="lh-editor-head">
              <span className="lh-editor-title">รายจ่ายใหม่</span>
              <span className="lh-chip">
                <Utensils size={14} strokeWidth={1.75} />
                อาหารและเครื่องดื่ม
              </span>
            </div>
            <Field value={s.amount} placeholder="0.00" focused={s.focus === "amount"} trailing={<span className="lh-unit">บาท</span>} box={{ "data-target": "amount", "data-cursor": "ibeam" }} />
            <Field value={s.note} placeholder="รายละเอียด" focused={s.focus === "note"} box={{ "data-target": "note", "data-cursor": "ibeam" }} />
            <div className="lh-editor-actions">
              <span className="lh-btn lh-btn--quiet">ยกเลิก</span>
              <span className="lh-btn lh-btn--primary" data-target="save">
                บันทึก
              </span>
            </div>
          </Popover>
          <span data-target="rest" style={{ position: "absolute", left: REST[layout].x, top: REST[layout].y }} />
        </>
      )}
    </Stage>
  );
}
