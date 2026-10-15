# ผลตรวจรุ่นทดลอง 0.1.0

## การตรวจเพิ่มสำหรับโมดูลลงทุน — 15 ตุลาคม 2569

| การตรวจ | ผล |
|---|---|
| Rust formatting / workspace Clippy (`-D warnings`) | ผ่าน |
| Rust workspace tests | 69 ผ่าน: application/contract/import/market/storage 35, salary 10, wealth core 24 |
| TypeScript / Vite production build / Prettier | ผ่าน |
| Vitest | 27 ผ่าน รวม decimal/เปอร์เซ็นต์, ตารางกราฟ และการตรวจ CSV |
| Playwright Chromium | 14 ผ่าน รวม tax 8 และ wealth 6; axe ธีมสว่าง/มืดและหน้าจอแคบ |
| SQLite migrations / restore | อัปเกรดฐานข้อมูลเก่า, restart, reject stale revision, rollback เมื่อแก้ย้อนหลัง/นำเข้า/กู้คืนล้มเหลว |
| Encrypted backup v2 และ legacy v1 | age round-trip ทั้งสองโมดูล; v1 กู้เฉพาะภาษีและคงข้อมูลลงทุน |
| Native macOS debug bundle | สร้าง `.app` สำเร็จและ `codesign --verify --deep --strict` ผ่าน; ad-hoc signing |

Native smoke ใช้ฐานข้อมูลสังเคราะห์ใน temporary directory ผ่าน `TAXLY_DATA_DIR` ไม่อ่านหรือเปลี่ยนฐานข้อมูลจริงของผู้ใช้ เปิดพื้นที่ลงทุนได้ก่อนทำ tax onboarding นำเข้า CSV ผ่าน native file chooser และตรวจสองแถวก่อนยืนยัน (deposit 20 THB และซื้อ PTT 0.25 หน่วยที่ราคา 40 THB) หลังนำเข้าได้ 6.25 หน่วย ต้นทุน 616 THB เงินสด 9,685 THB ปิดแล้วเปิดใหม่ยังอยู่ครบ

หลังแก้ URL ของ Yahoo ที่มี slash เกิน ได้ทดสอบ native refresh จริง: ดาวน์โหลดราคา PTT.BK 191 วัน พร้อมเก็บราคาบันทึกเองเดิมทั้ง 3 วัน ฐานข้อมูลมี 6 activities, `integrity_check=ok` และไม่มี foreign-key errors การทดสอบ Yahoo เป็นหลักฐานการเชื่อมต่อในรอบนี้เท่านั้น ผู้ให้บริการอาจจำกัดคำขอหรือมีข้อมูลล่าช้า

Fixtures ของ portfolio ส่งออกจาก Rust และตรวจเทียบกับ engine ใน CI การทดสอบ browser ใช้ fixtures เหล่านี้เพื่อยืนยัน UI และ IPC; การทดสอบ persistence/encryption ใช้ SQLite และ age จริงแยกชั้นกัน ดูขอบเขตและวิธีคำนวณใน [เอกสารโมดูลลงทุน](planning/13-wealth.md)

การลงนาม Developer ID/notarization และ release gates ของภาษีด้านล่างยังคงเป็นเงื่อนไขก่อนแจกจ่ายภายนอก ไม่มีการเชื่อมผลลงทุนเข้า tax engine

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
