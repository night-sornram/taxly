import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { command, errorMessage, isCancelled } from "./api";
import { Button, Checkbox, ErrorNotice, Field, Modal, Notice } from "./components";
import type { BackupSummary } from "./types";

export default function Privacy({
  onRestored,
  onSuccess,
}: {
  onRestored: () => Promise<void>;
  onSuccess: (message: string) => void;
}) {
  const [mode, setMode] = useState<"export" | "restore" | "delete" | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (busy) return;
    setMode(null);
    setPassword("");
    setRepeat("");
    setConfirmation("");
    setSummary(null);
    setAcknowledged(false);
    setError("");
    void command("cancel_restore").catch(() => {});
  };
  const open = (mode: "export" | "restore" | "delete") => {
    setError("");
    setMode(mode);
  };
  const exportBackup = async () => {
    setBusy(true);
    setError("");
    try {
      if (password !== repeat) throw new Error("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      if ([...password].length < 12) throw new Error("ตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร");
      await command("export_backup", { password });
      setMode(null);
      setPassword("");
      setRepeat("");
      onSuccess("สำรองข้อมูลแบบเข้ารหัสแล้ว เก็บรหัสผ่านไว้ในที่ปลอดภัย");
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      if (!password) throw new Error("ระบุรหัสผ่านของไฟล์สำรอง");
      const result = await command<BackupSummary>("inspect_backup", {
        password,
      });
      setPassword("");
      setSummary(result);
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!summary || !acknowledged) return;
    setBusy(true);
    setError("");
    try {
      await command("restore_backup", { token: summary.token });
      setMode(null);
      setSummary(null);
      await onRestored();
      onSuccess("กู้คืนข้อมูลครบแล้ว กรุณาตรวจปีภาษีและรายการของคุณ");
    } catch (e) {
      setError(errorMessage(e));
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (confirmation !== "ลบข้อมูล") return;
    setBusy(true);
    setError("");
    try {
      await command("delete_all_data");
      setMode(null);
      setConfirmation("");
      await onRestored();
      onSuccess("ลบข้อมูลในแอปแล้ว ไฟล์สำรองภายนอกยังคงอยู่");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>ข้อมูลของคุณ อยู่กับคุณ</h1>
          <p>ภาษีคำนวณในเครื่อง รายรับรายจ่ายซิงก์ได้เมื่อคุณเปิดใช้ ไม่มีสถิติการใช้งาน</p>
        </div>
        <span className="badge actual">
          <ShieldCheck size={13} /> LOCAL FIRST
        </span>
      </div>
      <section className="privacy-hero">
        <span className="privacy-hero-icon">
          <LockKeyhole size={42} strokeWidth={1.3} />
        </span>
        <div>
          <h2>เรื่องเงินเป็นเรื่องส่วนตัว</h2>
          <p>
            บันทึกและคำนวณในเครื่อง ใช้งานได้โดยไม่ต่ออินเทอร์เน็ต
            <br />
            เมื่อเปิดซิงก์ รายรับรายจ่าย หมวดหมู่ และตัวเลือกเชื่อมภาษีจะเก็บใน Supabase ของคุณ
            แบบสอบถามและผลคำนวณภาษียังอยู่ในคอมพิวเตอร์
          </p>
          <div className="privacy-tags">
            <span>
              <WifiOff size={14} /> ใช้ได้ออฟไลน์
            </span>
            <span>
              <Database size={14} /> SQLite ในเครื่อง
            </span>
            <span>
              <ShieldCheck size={14} /> ไม่ขอเลขบัตรประชาชน
            </span>
          </div>
        </div>
      </section>
      <div className="privacy-grid">
        <section className="card privacy-action">
          <span className="soft-icon">
            <ArrowDownToLine size={22} />
          </span>
          <h2>สำรองอย่างเป็นส่วนตัว</h2>
          <p>
            เก็บข้อมูลภาษี รายรับรายจ่าย และประวัติผลคำนวณเป็นไฟล์เข้ารหัสด้วยรหัสผ่านที่คุณตั้งเอง
          </p>
          <Button onClick={() => open("export")}>
            สร้างไฟล์สำรอง <ArrowDownToLine size={16} />
          </Button>
          <small>รหัสผ่านไม่ถูกเก็บในแอป และกู้คืนรหัสผ่านให้ไม่ได้</small>
        </section>
        <section className="card privacy-action">
          <span className="soft-icon">
            <ArrowUpFromLine size={22} />
          </span>
          <h2>กลับมาพร้อมข้อมูลเดิม</h2>
          <p>เลือกไฟล์สำรอง ตรวจขอบเขตและรายการที่จะกู้คืน แล้วจึงยืนยันแทนข้อมูลปัจจุบัน</p>
          <Button variant="secondary" onClick={() => open("restore")}>
            กู้คืนจากไฟล์ <ArrowUpFromLine size={16} />
          </Button>
          <small>ตรวจรหัสผ่าน รุ่นข้อมูล และชุดกฎก่อนเริ่มกู้คืน</small>
        </section>
      </div>
      <Notice>
        <strong>สิ่งที่ควรรู้:</strong> ฐานข้อมูลที่กำลังใช้งานยังไม่เข้ารหัส
        ป้องกันด้วยสิทธิ์ไฟล์ของระบบ ผู้ที่เข้าถึงบัญชีผู้ใช้ระบบเดียวกันอาจอ่านข้อมูลได้
        การเข้ารหัสใช้กับไฟล์สำรองเท่านั้น
      </Notice>
      <section className="card danger-zone">
        <div>
          <h2>ลบข้อมูลในแอป</h2>
          <p>
            ลบข้อมูลภาษีและรายรับรายจ่ายในคอมเครื่องนี้ และพักการซิงก์
            ข้อมูลออนไลน์และไฟล์สำรองยังอยู่ บัญชีซิงก์เดิมยังผูกกับเครื่องเพื่อป้องกันข้อมูลปะปน
          </p>
        </div>
        <Button variant="danger" onClick={() => open("delete")}>
          <Trash2 size={16} /> ลบข้อมูลทั้งหมด
        </Button>
      </section>
      {mode && (
        <Modal
          title={
            mode === "export"
              ? "สร้างไฟล์สำรองเข้ารหัส"
              : mode === "restore"
                ? "กู้คืนข้อมูลจากไฟล์"
                : "ลบข้อมูลภาษีและรายรับรายจ่าย"
          }
          onClose={close}
        >
          {mode === "export" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void exportBackup();
              }}
            >
              <p>
                ตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร แล้วเลือกตำแหน่งเก็บไฟล์
                ไม่ควรเก็บรหัสผ่านไว้ในที่เดียวกับไฟล์
              </p>
              <Field
                label="รหัสผ่านสำหรับไฟล์สำรอง"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
              <Field
                label="ยืนยันรหัสผ่าน"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                required
              />
              <Notice tone="warning">หากลืมรหัสผ่าน จะไม่สามารถกู้คืนข้อมูลจากไฟล์นี้ได้</Notice>
              {error && <ErrorNotice message={error} />}
              <div className="modal-actions">
                <Button variant="secondary" disabled={busy} onClick={close}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "กำลังสำรอง…" : "เลือกที่เก็บไฟล์"}
                </Button>
              </div>
            </form>
          )}
          {mode === "restore" && !summary && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void inspect();
              }}
            >
              <p>
                ระบุรหัสผ่านของไฟล์ แล้วเลือกไฟล์ .taxly.age
                ข้อมูลเดิมยังไม่เปลี่ยนจนกว่าคุณจะยืนยันอีกครั้ง
              </p>
              <Field
                label="รหัสผ่านของไฟล์สำรอง"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
              {error && <ErrorNotice message={error} />}
              <div className="modal-actions">
                <Button variant="secondary" disabled={busy} onClick={close}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "กำลังตรวจไฟล์…" : "เลือกและตรวจไฟล์"}
                </Button>
              </div>
            </form>
          )}
          {mode === "restore" && summary && (
            <>
              <Notice tone="warning">
                {summary.restore_scope === "tax_only"
                  ? "ไฟล์รุ่นเก่าแทนที่เฉพาะข้อมูลภาษีทุกปี รายรับรายจ่ายปัจจุบันยังอยู่ แต่จะเลิกนับในภาษี ข้อมูลการลงทุนในไฟล์จะไม่ถูกนำเข้า"
                  : "ไฟล์นี้แทนที่ข้อมูลภาษีและรายรับรายจ่ายทั้งหมด ไม่ได้รวมรายการเข้าด้วยกัน"}{" "}
                ควรสำรองข้อมูลปัจจุบันไว้ก่อน การกู้คืนจะพักซิงก์จนกว่าคุณจะเปิดใช้อีกครั้ง
              </Notice>
              <div className="review-list">
                <div>
                  <span>ปีภาษีในไฟล์</span>
                  <strong>
                    {summary.years.map((year) => year + 543).join(", ") || "ไม่มีข้อมูลปีภาษี"}
                  </strong>
                </div>
                <div>
                  <span>รายได้</span>
                  <strong>{summary.income_count} รายการ</strong>
                </div>
                <div>
                  <span>ประกันสังคม</span>
                  <strong>{summary.deduction_count} รายการ</strong>
                </div>
                <div>
                  <span>ผลสรุปเดิม</span>
                  <strong>{summary.snapshot_count} รายการ</strong>
                </div>
                <div>
                  <span>แบบสอบถามที่ยังไม่เสร็จ</span>
                  <strong>{summary.draft_count} ชุด</strong>
                </div>
                {summary.restore_scope !== "tax_only" && (
                  <div>
                    <span>รายรับรายจ่าย</span>
                    <strong>{summary.ledger_count} รายการ</strong>
                  </div>
                )}
              </div>
              <Checkbox checked={acknowledged} onChange={setAcknowledged}>
                {summary.restore_scope === "tax_only"
                  ? "ฉันตรวจข้อมูลแล้ว และต้องการแทนที่ข้อมูลภาษีปัจจุบันทั้งหมด"
                  : "ฉันตรวจข้อมูลแล้ว และต้องการแทนที่ข้อมูลปัจจุบันทั้งหมด"}
              </Checkbox>
              <div className="modal-actions">
                <Button variant="secondary" disabled={busy} onClick={close}>
                  เก็บข้อมูลเดิมไว้
                </Button>
                <Button disabled={busy || !acknowledged} onClick={() => void restore()}>
                  {busy ? "กำลังกู้คืน…" : "ยืนยันกู้คืนข้อมูล"}
                </Button>
              </div>
            </>
          )}
          {mode === "delete" && (
            <>
              <Notice tone="warning">
                ข้อมูลภาษีและรายรับรายจ่ายที่เก็บไว้จะถูกลบ ย้อนกลับได้เฉพาะเมื่อคุณมีไฟล์สำรอง
              </Notice>
              <Field
                label="พิมพ์ “ลบข้อมูล” เพื่อยืนยัน"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoFocus
              />
              {error && <ErrorNotice message={error} />}
              <div className="modal-actions">
                <Button variant="secondary" disabled={busy} onClick={close}>
                  เก็บไว้ก่อน
                </Button>
                <Button
                  variant="danger"
                  disabled={busy || confirmation !== "ลบข้อมูล"}
                  onClick={() => void remove()}
                >
                  {busy ? "กำลังลบ…" : "ลบข้อมูลในแอปทั้งหมด"}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
