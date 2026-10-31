# ผลตรวจรุ่นทดลอง 0.1.0

## มือถือและการซิงก์ — 31 ตุลาคม 2569

- Vitest: 41 ผ่าน รวมการรวมข้อมูลที่แก้ต่างเครื่อง การแก้ชนกัน การส่งซ้ำเมื่อคำตอบหาย การลบระหว่างส่ง การเปิด engine ใหม่ และหมวดหมู่ชื่อเดียวกันที่สร้างแยกกันออฟไลน์
- Rust: 26 ผ่าน (application 14 + tax core 12) รวมการรักษา ID ภาษีในเครื่อง การ rollback ข้อมูลซิงก์ที่เชื่อมปีภาษียังไม่ตั้งค่า การบันทึก upload intent ข้ามการเปิดฐานข้อมูลใหม่ CAS และการพักซิงก์หลังล้างข้อมูล Clippy `-D warnings` และ formatting ผ่าน
- PostgreSQL 17 ใน cluster ชั่วคราวที่เปิดเฉพาะ Unix socket: migration จริง, RLS สองบัญชี, สิทธิ์ anonymous/direct write, RPC, revision, receipt replay/hash mismatch, duplicate ID, category reference/kind, date และจำนวนเงินเกินช่วง ผ่าน รันซ้ำได้ด้วย `scripts/test-ledger-sync-sql.sh` ใช้ `PG_BIN` เลือกไดเรกทอรี PostgreSQL ได้ ไม่แตะโปรเจกต์ Supabase จริง
- Playwright Chromium ทั้งชุด: 17 ผ่าน + ข้าม 1 กรณีที่ต้องใช้ production build ส่วนมือถือใช้ Supabase auth/RPC/WebSocket จำลองและ IndexedDB จริง แยกสอง browser context ทดสอบเพิ่ม/แก้/ลบสดและรายการค้างส่งหลัง reload
- Production PWA: 3 ผ่าน รวม reload ออฟไลน์ บันทึกออฟไลน์ reload อีกครั้ง และส่งเมื่อกลับออนไลน์ ใช้ service worker ที่ build จริง ตรวจ axe และความกว้าง 320 px ทั้งธีมสว่าง/มืดผ่าน
- TypeScript, Prettier และ Vite build ผ่าน ผลตรวจเหล่านี้ยังไม่ใช่การทดสอบ Supabase บนคลาวด์หรือโทรศัพท์จริง ต้องสร้างโปรเจกต์และโฮสต์ HTTPS แล้วตรวจอีกครั้งตาม [คู่มือซิงก์มือถือ](mobile-sync.md)
- สร้าง macOS release `.app`/`.dmg` สำหรับ arm64 ใหม่แล้ว ตรวจ `codesign --verify --deep --strict` และ `hdiutil verify` ผ่าน ยังไม่ได้ติดตั้งทับหรือเปิดใช้ข้อมูลจริงของผู้ใช้

## รายรับรายจ่ายแทนโมดูลลงทุน — 31 ตุลาคม 2569

ถอดโมดูลลงทุนออก (ผู้ใช้ย้ายไปใช้ Wealthfolio) โค้ดเดิมรวมงาน DCA เก็บไว้ที่ branch `archive/wealth-dca` migration `0006_ledger.sql` ลบตาราง `wealth_*` และข้อมูลในตารางเหล่านั้นถาวร แล้วสร้างตารางรายรับรายจ่าย

| การตรวจ | ผล |
|---|---|
| Rust formatting / workspace Clippy (`-D warnings`) | ผ่าน |
| Rust workspace tests | ผ่านทั้งหมด รวมการอัปเกรดฐานข้อมูลที่มีข้อมูลลงทุน, การซิงก์รายรับที่นับภาษี, การปฏิเสธข้อมูลไม่ถูกต้อง, CSV UTF-8/TIS-620 และ backup v3 |
| TypeScript / Vite production build / Prettier | ผ่าน |
| Vitest | ผ่าน รวมยอดรวมแบบสตางค์ และการอ่านวันที่/จำนวนเงินจาก CSV |
| Playwright Chromium | ผ่าน รวมรายรับรายจ่าย 4 กรณีและ axe หน้าจอหลักและหน้าจอแคบ |

ไฟล์สำรองรุ่น 3 มีข้อมูลรายรับรายจ่าย ไฟล์รุ่น 1/2 ยังกู้คืนได้เฉพาะข้อมูลภาษี ส่วนข้อมูลลงทุนในไฟล์รุ่น 2 ถูกข้าม

## ผลตรวจฐานภาษีเดิม

ตรวจวันที่ 15 ตุลาคม 2569 บน macOS 27.0.1 / Apple Silicon, Rust 1.95.0, Node 26.11.1 และ npm 11.20.0

## ผ่านแล้ว

| การตรวจ | ผล |
|---|---|
| Rust formatting / Clippy (`-D warnings`) | ผ่าน |
| Rust workspace tests | 17 ผ่าน: Core 10, application/contract 6 และ fixture export helper 1 |
| TypeScript / production frontend build / Prettier | ผ่าน |
| Vitest | 13 ผ่าน |
| Playwright Chromium | 8 ผ่าน รวม onboarding, income CRUD, forecast replacement, restore confirmation, mobile และ axe accessibility |
| SQLite / age backup | ทดสอบฐานข้อมูลและ encryption จริง รวมเปิดฐานข้อมูลใหม่, wrong password, ไฟล์เสีย, format/hash ไม่รองรับ และ rollback หลังเริ่มแทนข้อมูล |
| macOS release packaging | สร้าง `.app` และ `.dmg` สำหรับ arm64 สำเร็จ |
| Bundle signature / DMG integrity | `codesign --verify --deep --strict` และ `hdiutil verify` ผ่าน |
| npm production dependency audit | ไม่พบช่องโหว่ |

กฎทดสอบแยกอัตราตามกฎหมายจากสิทธิยกเว้นเงินได้สุทธิช่วงแรก รวมกรณีเศษครึ่งสตางค์ ผลลัพธ์ยังไม่ผ่านการปัดเป็นยอดชำระ/คืน การทดสอบขอบทุกขั้นเทียบผลต่างก่อน/หลังขอบ 0.01 บาท

Browser E2E ใช้ IPC adapter สำหรับทดสอบ UI โดย fixture ส่งออกจาก Rust และตรวจเทียบกับ engine ปัจจุบัน ไม่ใช่หลักฐานของ native storage หรือ encryption ซึ่งมี integration tests แยกกัน

## Native smoke test

ตรวจแอป Tauri จริงด้วยข้อมูลสังเคราะห์ใน directory แยกจากข้อมูลผู้ใช้: ปี 2568 เงินเดือน 30,000 บาท 12 เดือน ประกันสังคม 750 บาทต่อเดือน และภาษีหัก ณ ที่จ่าย 250 บาทต่อเดือน ได้รายได้ 360,000 บาท เงินได้สุทธิ 191,000 บาท ภาษี 2,050 บาท และส่วนต่างเชิงคำนวณ 950 บาท โดยยอดชำระ/คืนยังถูกปิดตามนโยบาย

บันทึกประวัติสำเร็จ เปิด native save dialog ได้ และยกเลิกโดยข้อมูลไม่เปลี่ยน ตรวจไฟล์ SQLite หลังปิดแอปพบรายการเงินเดือน 12, ประกันสังคม 12 และ snapshot 1; `integrity_check=ok` และไม่มี foreign key errors

การเปิดแอปซ้ำรอบสุดท้ายหลังเพิ่มการจำปีที่เลือกและรายละเอียดแหล่งกฎ **ยังไม่ได้ตรวจผ่าน UI** เพราะเครื่องเข้าสู่หน้าจอล็อก ไม่มีการปิด Wi-Fi หรือแก้ network settings ของผู้ใช้

## แพ็กเกจ

- `target/release/bundle/macos/Taxly.app`
- `target/release/bundle/dmg/Taxly_0.1.0_aarch64.dmg`
- SHA-256 ของ DMG: `1dd63d5f4d2eebb0ad50acde2fe603725f78cb346560c47f397a606d4e026fec`

สร้างด้วย `CI=true npm run tauri -- build --bundles app,dmg` เพื่อข้ามการตกแต่งตำแหน่งไอคอนใน Finder ที่ timeout บนเครื่องนี้ ลงนามแบบ ad-hoc ตาม [เอกสาร Tauri](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) ไม่มี Apple Developer ID signing/notarization

## เกณฑ์ก่อนเผยแพร่ที่ยังเหลือ

- ผู้ทบทวนภาษียืนยันวิธีปัดเศษทุกขั้น เครดิต และยอดคืน พร้อม regression fixtures; ไม่เปิด settlement ด้วยการเปลี่ยน flag เพียงอย่างเดียว
- ตรวจคู่มือประจำปี 2569 เมื่อเผยแพร่ ชุดกฎปีนี้ยังเป็น `provisional`
- Native รอบสุดท้าย: restart/จำปี, offline ด้วย network isolation ของ test harness และ export/restore ผ่าน file dialogs ครบวงจร
- VoiceOver จริง ข้อความขยาย และ usability กับผู้ใช้ใหม่ 5 คน
- ทบทวน dependency advisories และ Apple signing/notarization ก่อนแจกจ่ายภายนอก

`cargo audit` ทั้ง lockfile ยังมี advisory/warnings รายละเอียดและขอบเขตที่ compile บน macOS อยู่ใน [บันทึก security](planning/11-security.md) ไม่ได้เพิ่ม audit ignores เพื่อทำให้รายงานดู clean

รุ่นนี้พร้อมทดลองในเครื่องและพัฒนาต่อ **ยังไม่ถือว่าผ่านเกณฑ์อนุมัติ MVP สำหรับเผยแพร่ภายนอก**
