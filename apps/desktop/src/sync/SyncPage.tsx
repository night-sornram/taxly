import { useState } from "react";
import { Cloud, CloudOff, RefreshCw, Smartphone } from "lucide-react";
import { isDesktop, errorMessage, command } from "../api";
import { Brand, Button, ErrorNotice, Field, Loading, Notice } from "../components";
import { useCloud } from "./SyncProvider";
import { formatMoney } from "../money";
import type { Conflict } from "./model";
import "./sync.css";

export function SyncBadge({ onOpen }: { onOpen: () => void }) {
  const cloud = useCloud();
  const labels = {
    idle: "กำลังเชื่อม",
    paused: "ซิงก์หยุดอยู่",
    syncing: "กำลังซิงก์",
    synced: "ซิงก์แล้ว",
    offline: "ออฟไลน์",
    conflict: "ตรวจรายการชนกัน",
    error: "ซิงก์ไม่สำเร็จ",
  };
  return (
    <button className="sync-badge" onClick={onOpen} aria-label="บัญชีและการซิงก์">
      <Cloud size={16} />
      <span>
        {cloud.identity ? labels[cloud.status.phase] : "ใช้บนโทรศัพท์"}
        {cloud.status.pending > 0 && cloud.enabled ? ` · รอส่ง ${cloud.status.pending}` : ""}
      </span>
    </button>
  );
}
function ConflictValue({
  value,
  categoryName,
}: {
  value: Conflict["local"];
  categoryName?: string;
}) {
  if (!value) return <p>ลบรายการนี้</p>;
  if ("amount" in value)
    return (
      <div>
        <strong>{formatMoney(value.amount)} บาท</strong>
        <p>
          {value.date} · {value.note || "ไม่มีบันทึก"}
        </p>
        <p>หมวดหมู่: {categoryName || "หมวดหมู่เดิม"}</p>
        <p>
          {value.tax
            ? `เชื่อมภาษี · ${value.tax.source_label} · ${{ salary: "เงินเดือน", bonus: "โบนัส", other: "รายได้อื่น" }[value.tax.kind]} · หัก ณ ที่จ่าย ${value.tax.withholding === null ? "ไม่ทราบ" : `${formatMoney(value.tax.withholding)} บาท`}`
            : "ไม่เชื่อมภาษี"}
        </p>
      </div>
    );
  return (
    <p>
      {value.name} · {value.kind === "income" ? "รายรับ" : "รายจ่าย"}
    </p>
  );
}
export default function SyncPage({ standalone = false }: { standalone?: boolean }) {
  const cloud = useCloud();
  const [url, setUrl] = useState(cloud.config?.url ?? ""),
    [key, setKey] = useState(""),
    [webUrl, setWebUrl] = useState(cloud.config?.webUrl ?? "");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"),
    [configure, setConfigure] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const redirect = cloud.config?.webUrl || (isDesktop() ? undefined : window.location.origin);
  const auth = async () => {
    if (!cloud.client) return;
    if (cloud.recovery) {
      const { error } = await cloud.client.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      cloud.finishRecovery();
      setMessage("ตั้งรหัสผ่านใหม่แล้ว");
      return;
    }
    if (mode === "login") {
      const { error } = await cloud.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
    } else if (mode === "signup") {
      const { data, error } = await cloud.client.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirect },
      });
      if (error) throw error;
      setPassword("");
      if (!data.session) setMessage("ส่งอีเมลยืนยันแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
    } else {
      const { error } = await cloud.client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirect,
      });
      if (error) throw error;
      setMessage("หากมีบัญชีนี้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปทางอีเมล");
    }
  };
  const body = (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>ใช้รายรับรายจ่ายบนโทรศัพท์</h1>
          <p>เข้าใช้บัญชีเดียวกันบนคอมและมือถือ รายการจะซิงก์เมื่อออนไลน์</p>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {message && <Notice tone="success">{message}</Notice>}
      {cloud.status.message && <ErrorNotice message={cloud.status.message} />}
      {!cloud.config || configure ? (
        <section className="card sync-panel">
          <h2>เชื่อมบริการสำหรับ Taxly</h2>
          <p>
            ตั้งค่า Supabase โปรเจกต์ของคุณครั้งเดียว
            ข้อมูลรายรับรายจ่ายและตัวเลือกเชื่อมภาษีจะซิงก์เฉพาะบัญชีที่เข้าใช้
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                cloud.configure({ url, key, webUrl });
                setKey("");
                setConfigure(false);
              });
            }}
          >
            <Field
              label="Supabase Project URL"
              type="url"
              placeholder="https://your-project.supabase.co"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Field
              label="Publishable key"
              hint="ใช้ publishable หรือ anon key เท่านั้น ไม่ใช้ secret / service_role key"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <Field
              label="ที่อยู่เว็บมือถือ (ถ้ามี)"
              type="url"
              placeholder="https://taxly.example.com"
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
            />
            <Notice>
              ต้องสร้างตารางซิงก์ใน Supabase ก่อนใช้งาน ดูขั้นตอนในเอกสาร Mobile sync ของโปรเจกต์
            </Notice>
            <div className="modal-actions">
              {cloud.config && (
                <Button variant="secondary" onClick={() => setConfigure(false)}>
                  ยกเลิก
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                บันทึกการเชื่อมต่อ
              </Button>
            </div>
          </form>
        </section>
      ) : cloud.loading ? (
        <Loading label="กำลังตรวจบัญชี…" />
      ) : !cloud.identity || cloud.recovery ? (
        <section className="card sync-panel">
          <h2>
            {cloud.recovery
              ? "ตั้งรหัสผ่านใหม่"
              : mode === "signup"
                ? "สร้างบัญชีส่วนตัว"
                : mode === "reset"
                  ? "ลืมรหัสผ่าน"
                  : "เข้าสู่ระบบ"}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(auth);
            }}
          >
            {!cloud.recovery && (
              <Field
                label="อีเมล"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            {(mode !== "reset" || cloud.recovery) && (
              <Field
                label="รหัสผ่าน"
                type="password"
                autoComplete={
                  mode === "signup" || cloud.recovery ? "new-password" : "current-password"
                }
                minLength={mode === "signup" || cloud.recovery ? 12 : undefined}
                hint={mode === "signup" ? "ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร" : undefined}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <div className="modal-actions">
              <Button type="submit" disabled={busy}>
                {busy
                  ? "กำลังดำเนินการ…"
                  : cloud.recovery
                    ? "บันทึกรหัสผ่าน"
                    : mode === "signup"
                      ? "สร้างบัญชี"
                      : mode === "reset"
                        ? "ส่งลิงก์ตั้งรหัสผ่าน"
                        : "เข้าสู่ระบบ"}
              </Button>
            </div>
          </form>
          {!cloud.recovery && (
            <div className="sync-links">
              <Button
                variant="ghost"
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? "ยังไม่มีบัญชี สร้างบัญชีใหม่" : "กลับไปเข้าสู่ระบบ"}
              </Button>
              {mode === "login" && (
                <Button variant="ghost" onClick={() => setMode("reset")}>
                  ลืมรหัสผ่าน
                </Button>
              )}
              <Button variant="ghost" onClick={() => setConfigure(true)}>
                เปลี่ยนการเชื่อมต่อ
              </Button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card sync-panel">
            <div className="sync-account-heading">
              <Cloud size={25} />
              <div>
                <h2>{cloud.identity.email || "บัญชีของฉัน"}</h2>
                <p>{cloud.enabled ? "เชื่อมกับบัญชีนี้แล้ว" : "พร้อมเชื่อมข้อมูลในเครื่อง"}</p>
              </div>
            </div>
            {!cloud.enabled ? (
              <>
                <p>
                  เริ่มซิงก์รายรับรายจ่าย {cloud.localEntries} รายการกับบัญชีนี้
                  หากมีข้อมูลอยู่บนคลาวด์แล้ว ระบบจะตรวจรวมข้อมูลก่อน
                  ไม่ส่งแบบสอบถามหรือผลคำนวณภาษีขึ้นคลาวด์
                </p>
                <p>
                  ส่งข้อมูลผ่าน HTTPS และจำกัดสิทธิ์ตามบัญชี
                  ข้อมูลออนไลน์ไม่ได้เข้ารหัสแบบปลายทางถึงปลายทาง ผู้ดูแลโปรเจกต์ Supabase
                  สามารถอ่านได้
                </p>
                <Button disabled={busy || !cloud.ready} onClick={() => void act(cloud.connect)}>
                  เริ่มซิงก์กับบัญชีนี้
                </Button>
              </>
            ) : (
              <>
                <p role="status">
                  {cloud.status.phase === "synced"
                    ? "ซิงก์ล่าสุดสำเร็จ"
                    : cloud.status.phase === "syncing"
                      ? "กำลังซิงก์รายการ"
                      : cloud.status.phase === "offline"
                        ? "ออฟไลน์ บันทึกในเครื่องได้"
                        : cloud.status.phase === "conflict"
                          ? "รอตรวจรายการแก้ไขชนกัน"
                          : "กำลังเชื่อมต่อ"}{" "}
                  · รอส่ง {cloud.status.pending} รายการ
                </p>
                {cloud.status.lastSynced && (
                  <p>อัปเดต {new Date(cloud.status.lastSynced).toLocaleTimeString("th-TH")}</p>
                )}
                <div className="sync-links">
                  <Button disabled={busy || cloud.status.phase === "syncing"} onClick={cloud.sync}>
                    <RefreshCw size={15} />
                    ซิงก์ตอนนี้
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void act(cloud.pause)}>
                    <CloudOff size={15} />
                    พักการซิงก์
                  </Button>
                </div>
              </>
            )}
            <div className="sync-links">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const { error } = await cloud.client!.auth.signOut({ scope: "local" });
                    if (error) throw error;
                  })
                }
              >
                ออกจากระบบบนเครื่องนี้
              </Button>
            </div>
          </section>
          {cloud.status.conflicts.length > 0 && (
            <section className="card sync-panel">
              <h2>เลือกรายการที่จะเก็บ</h2>
              <p>รายการเดียวกันถูกแก้ไขมากกว่าหนึ่งเครื่อง ข้อมูลจะยังไม่ถูกทับจนกว่าจะเลือกครบ</p>
              {cloud.status.conflicts.map((c) => (
                <fieldset className="sync-conflict" key={c.key}>
                  <legend>{c.kind === "entries" ? "รายการรายรับรายจ่าย" : "หมวดหมู่"}</legend>
                  {(["local", "remote"] as const).map((side) => (
                    <label key={side}>
                      <input
                        type="radio"
                        name={c.key}
                        checked={choices[c.key] === side}
                        onChange={() => setChoices((old) => ({ ...old, [c.key]: side }))}
                      />
                      <div>
                        <strong>{side === "local" ? "ข้อมูลในเครื่องนี้" : "ข้อมูลออนไลน์"}</strong>
                        <ConflictValue
                          value={side === "local" ? c.local : c.remote}
                          categoryName={side === "local" ? c.localCategory : c.remoteCategory}
                        />
                      </div>
                    </label>
                  ))}
                </fieldset>
              ))}
              <Button
                disabled={busy || cloud.status.conflicts.some((c) => !choices[c.key])}
                onClick={() =>
                  void act(async () => {
                    await cloud.resolve(choices);
                    setChoices({});
                  })
                }
              >
                ยืนยันตัวเลือกและซิงก์
              </Button>
            </section>
          )}
          <section className="card sync-panel">
            <h2>
              <Smartphone size={22} /> เปิดบนโทรศัพท์
            </h2>
            {redirect ? (
              <p>
                <a
                  href={redirect}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (isDesktop()) {
                      e.preventDefault();
                      void act(() => command<void>("open_ledger_mobile", { url: redirect }));
                    }
                  }}
                >
                  {redirect}
                </a>
              </p>
            ) : (
              <p>
                เมื่อนำเว็บ Taxly ขึ้นโฮสต์แล้ว เปิดที่อยู่ HTTPS
                บนโทรศัพท์และเข้าสู่ระบบด้วยบัญชีนี้
              </p>
            )}
            <p>
              iPhone: Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม
              <br />
              Android: Chrome → เมนู → เพิ่มลงในหน้าจอหลัก
            </p>
            <p>
              ใช้แบบออฟไลน์ได้หลังเปิดและเข้าสู่ระบบครั้งแรก
              รายการที่ยังไม่ซิงก์เก็บไว้ในเครื่องและส่งเมื่อกลับมาออนไลน์
            </p>
          </section>
        </>
      )}
    </>
  );
  return standalone ? (
    <div className="sync-standalone">
      <header>
        <Brand />
      </header>
      <main>{body}</main>
    </div>
  ) : (
    body
  );
}
