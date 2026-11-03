import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Banknote, Bus, Cloud, Coffee, FileSpreadsheet, Gift, GraduationCap, HeartPulse, House, Lock, PawPrint, ShieldCheck, ShoppingBag, Tag, Utensils, Zap, type LucideIcon } from "lucide-react";
import { Bar, Collapse, Connector, Count, Field, Phone, Stage, States, Text, type Act, type Rect } from "../kit";
import "./look.css";
import "./features.css";

// The features grid (references/bento.md), hero and strip:
//
//   Tile        Span   Kind        The one thing                         Moves
//   Tax         2 × 1  Component   the year's tax estimate and its sums  social security joins, the tax rolls down
//   Privacy     1 × 1  Statement   "ข้อมูลของคุณ อยู่กับคุณ"            nothing
//   Phone       1 × 1  Hero UI     the phone ledger, an entry synced     the entry drops in
//   Categories  1 × 1  Component   a category named, its icon follows    the icon turns into a paw
//   Import      1 × 1  Diagram     one CSV, three ledger rows            the lines draw in
//
// No window chrome anywhere in the grid: the page hero above has the one.
// Each picture is its own Stage at 1:1, pinned to its tile's bottom. Each
// plays one beat, once, as it scrolls in, 110ms after the tile before it.

const STEP = 110;
const LEAD = 450;

type Beat = { on: boolean; then: boolean };
const before: Beat = { on: false, then: false };
const after: Beat = { on: true, then: true };
const beat = (i: number, gap = 600) => async (a: Act<Beat>) => {
  await a.wait(LEAD + i * STEP);
  await a.set({ on: true });
  await a.wait(gap);
  await a.set({ then: true });
};

const baht = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usePictureWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tile({ area, lead, children, picture }: { area: string; lead: ReactNode; children: ReactNode; picture: ReactNode }) {
  return (
    <section className={`fx-tile fx-tile--${area}`}>
      <p className="fx-copy">
        <b>{lead}</b> {children}
      </p>
      {picture}
    </section>
  );
}

/* ---------------- Tax (lead tile) ---------------- */

// Salary 360,000; expenses 100,000; personal 60,000; social security 9,000.
// Net 191,000 is taxed 5% above 150,000: 2,050. Without social security, 2,500.
function TaxCard({ s, wide }: { s: Beat; wide: boolean }) {
  const line = (label: string, value: string) => (
    <div className="fx-sum">
      <Text className="fx-sum-label">{label}</Text>
      <Text className="fx-sum-value tx-num">{value}</Text>
    </div>
  );
  return (
    <div className="fx-tax" data-wide={wide || undefined}>
      <div className="fx-tax-head">
        <span className="fx-tax-label">
          ภาษีทั้งปีโดยประมาณ <span className="fx-year">2568</span>
        </span>
        <span className="fx-tax-figure tx-num">
          <Count value={s.then ? 2050 : 2500} format={baht} duration={1000} />
          <span className="fx-tax-unit">บาท</span>
        </span>
        <span className="fx-tax-note">จากรายได้ที่บันทึกและคาดการณ์ไว้ทั้งปี</span>
      </div>
      <div className="fx-sums">
        {line("เงินได้ทั้งปี", "360,000.00")}
        {line("หักค่าใช้จ่าย", "−100,000.00")}
        {line("ลดหย่อนส่วนตัว", "−60,000.00")}
        <Collapse open={s.on} reveal="drop">
          <div className="fx-sum fx-sum--new">
            <Text className="fx-sum-label">ประกันสังคม</Text>
            <Text className="fx-sum-value tx-num">−9,000.00</Text>
          </div>
        </Collapse>
        <div className="fx-sum fx-sum--total">
          <Text className="fx-sum-label">เงินได้สุทธิ</Text>
          <span className="fx-sum-value tx-num">
            <Count value={s.then ? 191000 : 200000} format={baht} duration={900} />
          </span>
        </div>
      </div>
    </div>
  );
}

function Tax() {
  const [picture, width] = usePictureWidth();
  const wide = width >= 560;
  return (
    <Tile
      area="tax"
      lead="รู้ภาษีทั้งปีก่อนยื่นจริง"
      picture={
        <div ref={picture} className="fx-picture">
          <Stage<Beat> width={width} height={wide ? 320 : 340} initial={before} poster={after} play="once" script={beat(0, 700)} className="tx-look fx-stage">
            {(s) => <TaxCard s={s} wide={wide} />}
          </Stage>
        </div>
      }
    >
      เพิ่มค่าลดหย่อนเมื่อไร ตัวเลขก็ขยับตามทันที
    </Tile>
  );
}

/* ---------------- Privacy (statement) ---------------- */

function Privacy() {
  return (
    <section className="fx-tile fx-tile--privacy">
      <span className="fx-privacy-icon">
        <Lock size={22} strokeWidth={1.75} />
      </span>
      <p className="fx-statement">
        <span>ข้อมูลของคุณ</span> <span>อยู่กับคุณ</span>
      </p>
      <p className="fx-statement-sub">ภาษีคำนวณในเครื่อง ข้อมูลซิงก์ได้เมื่อคุณเปิดใช้ ไม่มีสถิติการใช้งาน</p>
    </section>
  );
}

/* ---------------- Phone (UI) ---------------- */

function PhoneRow({ icon: Glyph, tone, title, sub, amount }: { icon: LucideIcon; tone: string; title: string; sub: string; amount: string }) {
  return (
    <div className="fx-prow">
      <span className="tx-cat" data-tone={tone}>
        <Glyph size={20} strokeWidth={1.75} />
      </span>
      <span className="fx-prow-text">
        <Text className="fx-prow-title">{title}</Text>
        <Text className="fx-prow-sub">{sub}</Text>
      </span>
      <Text className="fx-prow-amount tx-num">{amount}</Text>
    </div>
  );
}

function PhoneFiller({ w }: { w: number }) {
  return (
    <div className="fx-prow">
      <Bar w={40} h={40} r={20} tone={1} />
      <span className="fx-prow-text fx-prow-text--bars">
        <Bar w={w} h={9} tone={3} />
        <Bar w={w - 30} h={8} tone={2} />
      </span>
      <Bar w={64} h={9} tone={3} />
    </div>
  );
}

function PhoneSync() {
  const [picture, width] = usePictureWidth();
  const phone = Math.min(340, width - 40);
  return (
    <Tile
      area="phone"
      lead="จดจากโทรศัพท์ก็ได้"
      picture={
        <div ref={picture} className="fx-picture">
          <Stage<Beat> width={width} height={270} initial={before} poster={after} play="once" script={beat(1)} className="tx-look fx-stage">
            {(s) => (
              <Phone width={phone} className="fx-phone" style={{ left: (width - phone) / 2 }}>
                <div className="fx-screen">
                  <div className="fx-screen-head">
                    <span className="fx-screen-title">รายรับรายจ่าย</span>
                    <span className="fx-synced" data-on={s.then || undefined}>
                      <Cloud size={16} strokeWidth={1.75} />
                      <States value={s.then ? "done" : "busy"} states={{ busy: "กำลังซิงก์", done: "ซิงก์แล้ว" }} />
                    </span>
                  </div>
                  <div className="fx-plist">
                    <Collapse open={s.on} reveal="drop">
                      <PhoneRow icon={Coffee} tone="peach" title="กาแฟ" sub="อาหารและเครื่องดื่ม" amount="−65.00" />
                    </Collapse>
                    <PhoneFiller w={120} />
                    <PhoneFiller w={96} />
                    <PhoneFiller w={132} />
                  </div>
                </div>
              </Phone>
            )}
          </Stage>
        </div>
      }
    >
      รายการซิงก์ถึงกันทุกเครื่อง แม้ออฟไลน์อยู่ก็จดไว้ก่อนได้
    </Tile>
  );
}

/* ---------------- Categories (component) ---------------- */

const SHELF: [LucideIcon, string][] = [
  [Utensils, "peach"],
  [Bus, "sky"],
  [House, "lilac"],
  [Zap, "lemon"],
  [ShoppingBag, "peach"],
  [HeartPulse, "mint"],
  [GraduationCap, "sky"],
  [ShieldCheck, "mint"],
  [Banknote, "mint"],
  [Gift, "lemon"],
];

function Categories() {
  const [picture, width] = usePictureWidth();
  const script = async (a: Act<Beat & { name: string }>) => {
    await a.wait(LEAD + 2 * STEP);
    await a.type("name", "น้องแมว", { interval: 90 });
    await a.set({ then: true });
  };
  return (
    <Tile
      area="cats"
      lead="ตั้งหมวดเอง ไอคอนตามมาเอง"
      picture={
        <div ref={picture} className="fx-picture">
          <Stage<Beat & { name: string }>
            width={width}
            height={270}
            initial={{ ...before, name: "" }}
            poster={{ ...after, name: "น้องแมว" }}
            play="once"
            script={script}
            className="tx-look fx-stage"
          >
            {(s) => (
              <>
                <div className="fx-newcat">
                  <span className="tx-cat fx-newcat-icon" data-tone={s.then ? "peach" : "lemon"}>
                    <States value={s.then ? "pet" : "tag"} states={{ tag: <Tag size={20} strokeWidth={1.75} />, pet: <PawPrint size={20} strokeWidth={1.75} /> }} />
                  </span>
                  <Field value={s.name} placeholder="ชื่อหมวดใหม่" focused={!s.then} className="fx-newcat-field" />
                </div>
                {[0, 1, 2].map((r) => (
                  <div key={r} className="fx-shelf" style={{ top: 108 + r * 54, left: r === 1 ? -6 : 20 }}>
                    {[...SHELF.slice(r * 3), ...SHELF.slice(0, r * 3)].map(([Glyph, tone], i) => (
                      <span key={i} className="tx-cat fx-shelf-icon" data-tone={tone}>
                        <Glyph size={18} strokeWidth={1.75} />
                      </span>
                    ))}
                  </div>
                ))}
              </>
            )}
          </Stage>
        </div>
      }
    >
      เปลี่ยนชื่อ เพิ่ม หรือลบหมวดได้ตามใจ
    </Tile>
  );
}

/* ---------------- Import (diagram) ---------------- */

const ROWS: { icon: LucideIcon; tone: string; amount?: string; w: number }[] = [
  { icon: Banknote, tone: "mint", amount: "+35,000.00", w: 0 },
  { icon: Bus, tone: "sky", w: 58 },
  { icon: ShoppingBag, tone: "peach", w: 70 },
];

function Import() {
  const [picture, width] = usePictureWidth();
  return (
    <Tile
      area="csv"
      lead="นำเข้าจาก CSV"
      picture={
        <div ref={picture} className="fx-picture">
          <Stage<Beat> width={width} height={270} initial={before} poster={after} play="once" script={beat(3)} className="tx-look fx-stage">
            {(s, rect) => {
              const file = rect("file");
              const out = (r: Rect) => ({ x: r.x + r.width, y: r.y + r.height / 2 });
              const into = (r: Rect) => ({ x: r.x, y: r.y + r.height / 2 });
              return (
                <>
                  <div className="fx-file" data-target="file">
                    <FileSpreadsheet size={28} strokeWidth={1.5} />
                    <Text className="fx-file-name">ตุลาคม.csv</Text>
                  </div>
                  <div className="fx-rows">
                    {ROWS.map((row, i) => (
                      <div key={i} className="fx-irow" data-target={`row-${i}`} data-on={s.then || undefined}>
                        <span className="tx-cat" data-tone={row.tone}>
                          <row.icon size={16} strokeWidth={1.75} />
                        </span>
                        {row.amount ? <Text className="fx-irow-amount tx-num">{row.amount}</Text> : <Bar w={row.w} h={7} tone={3} />}
                        <Bar w={44} h={6} tone={2} className="fx-irow-end" />
                      </div>
                    ))}
                  </div>
                  {file.width > 0 &&
                    ROWS.map((_, i) => {
                      const to = rect(`row-${i}`);
                      return to.width > 0 ? <Connector key={i} from={out(file)} to={into(to)} route="step" show={s.on} dots="end" className="fx-line" /> : null;
                    })}
                </>
              );
            }}
          </Stage>
        </div>
      }
    >
      ไฟล์ภาษาไทยแบบเก่าก็อ่านได้ ตรวจก่อนบันทึกทุกครั้ง
    </Tile>
  );
}

export function Features() {
  return (
    <div className="fx-grid">
      <Tax />
      <Privacy />
      <PhoneSync />
      <Categories />
      <Import />
    </div>
  );
}
