# Taxly

ผู้ช่วยภาษีไทยและติดตามพอร์ตลงทุนที่เก็บข้อมูลในเครื่อง สร้างด้วย **Rust · Tauri 2 · React · TypeScript · Tailwind CSS · SQLite/SQLx**

รุ่นทดลองสำหรับผู้โสดอายุต่ำกว่า 65 ปี มีเงินเดือน/โบนัสในประเทศ รองรับหลายนายจ้าง สิทธิ์ส่วนตัว ประกันสังคม ม.33 และเครดิตภาษีหัก ณ ที่จ่าย ปีภาษี **2568 / 2569**

## เริ่มใช้งาน

ต้องมี macOS Apple Silicon, Xcode Command Line Tools, Rustup และ Node.js **24.12+ หรือ 26+** โดย Rust toolchain ตรึงใน `rust-toolchain.toml`

```sh
cd apps/desktop
npm ci
npm run tauri dev
```

เปิดแอปจริงผ่าน Tauri สำหรับใช้งานฐานข้อมูล `npm run dev` เพียงอย่างเดียวเปิดเฉพาะ frontend และจะแสดงคำแนะนำให้เปิด desktop app ไม่มีการจำลองข้อมูลการเงินใน production frontend

สร้างแพ็กเกจทดลองในเครื่อง:

```sh
cd apps/desktop
npm run tauri build -- --bundles app,dmg
```

ผลลัพธ์อยู่ใน `target/release/bundle/` การแจกจ่ายแบบลงนามและ notarize ต้องตั้งค่า Apple Developer credentials เพิ่มเติม ไม่ได้เปิดการอัปเดตหรือเผยแพร่อัตโนมัติ

แพ็กเกจทดลองใช้ ad-hoc signature (`signingIdentity: "-"`) สำหรับทดสอบในเครื่อง ไม่ใช่ Developer ID ของ Apple

หากขั้นตกแต่งหน้าต่าง Finder ของ DMG ค้างหรือ timeout ใช้ `CI=true npm run tauri -- build --bundles app,dmg` เพื่อสร้าง DMG โดยข้ามเฉพาะการจัดตำแหน่งไอคอนผ่าน Finder

## สิ่งที่ทำได้

- พอร์ตหุ้น/ETF และเงินสดหลายสกุล แยกบัญชี รายการซื้อขาย ต้นทุน FIFO และผลตอบแทน TWR
- เริ่มด้วยประวัติรายการหรือยอดยกมา นำเข้า CSV พร้อมตรวจรายการซ้ำและแมปคอลัมน์
- ราคากับอัตราแลกเปลี่ยนบันทึกเองได้ หรือเปิดอัปเดตผ่าน Yahoo ตามต้องการ เก็บ cache เพื่อเปิดดูออฟไลน์
- ภาษีและการลงทุนแยกการคำนวณ ผลลงทุนยังไม่ถูกรวมในฐานภาษี
- Onboarding ภาษาไทย บันทึกขั้นที่ค้างไว้และกลับมาทำต่อ
- เงินเดือน/โบนัสแยกยอดจริงกับคาดการณ์ แก้รายการเดิมเป็นยอดจริงได้
- ไม่แทนภาษีหัก ณ ที่จ่ายที่ไม่ทราบด้วยศูนย์
- Dashboard คำอธิบายทีละขั้น แหล่งกฎ และประวัติผลคำนวณ
- ผู้ช่วยสิทธิ์ส่วนตัว/ประกันสังคม พร้อมรายการสิทธิ์ที่ยังไม่รวม
- สำรองทั้งภาษีและลงทุนแบบ `age` v2 ด้วยรหัสผ่าน กู้คืนไฟล์ v1 เฉพาะข้อมูลภาษีได้ และลบข้อมูลทั้งแอป
- ฟอนต์และกฎบรรจุมากับแอป ใช้งานหลักได้ออฟไลน์

## ข้อจำกัดของรุ่นทดลอง

**ยังไม่เปิดยอดสำหรับชำระหรือขอคืนภาษี** เนื่องจากจุดปัดเศษระหว่างขั้นและวิธีจัดการยอดคืนยังต้องยืนยันกับกรมสรรพากร ผลส่วนต่างที่แสดงเป็นเพียงผลเชิงคำนวณ ชุดกฎปี 2569 ยังเป็น `provisional` และต้องเทียบคู่มือประจำปีเมื่อเผยแพร่

ผู้สมรส อายุ 65 ปีขึ้นไป รายได้ต่างประเทศ เงินก้อนออกจากงาน สิทธิยกเว้นพิเศษ และสิทธิ์ลดหย่อนอื่นยังไม่รวมครบ แอปแจ้งขอบเขตก่อนแสดงผล และไม่ส่งแบบหรือชำระภาษีแทนผู้ใช้

ฐานข้อมูลใช้งาน **ยังไม่เข้ารหัส** ป้องกันด้วยสิทธิ์ไฟล์เฉพาะผู้ใช้ระบบ ไฟล์สำรองเข้ารหัสด้วยรหัสผ่านอย่างน้อย 12 ตัวอักษร ไม่มีบัญชี ไม่มี telemetry และไม่มี Cloud Sync การอัปเดตราคาเป็นตัวเลือกและปิดไว้เริ่มต้น เมื่อเปิดใช้ Yahoo จะเห็นสัญลักษณ์ที่ขอและ IP ของผู้ใช้ ราคามีความล่าช้าและอาจขาดข้อมูล

## ตรวจสอบ

จาก root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
```

จาก `apps/desktop`:

```sh
npm ci
npm run format:check
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Browser E2E ใช้ IPC adapter และข้อมูลสังเคราะห์ที่ส่งออกจาก Rust ไม่ได้ทดสอบ SQLite หรือ encryption ผ่าน browser การทดสอบ Rust ใช้ SQLite จริงและไฟล์สำรองเข้ารหัสจริงแยกต่างหาก ส่วน native smoke test ต้องตรวจบนแอป macOS ที่ build แล้ว

เมื่อเปลี่ยนพฤติกรรม engine ต้องทบทวนกฎและ fixtures ก่อนสร้าง contract fixture ใหม่:

```sh
TAXLY_EXPORT_FIXTURE=1 cargo test -p taxly-app export_contract_fixture_when_requested
```

Debug builds รองรับ `TAXLY_DATA_DIR` สำหรับแยกข้อมูล native smoke test; release builds ไม่อ่านตัวแปรนี้

## โครงสร้างและเอกสาร

`taxly-core` และ `wealth-core` ไม่มี Tauri/SQLx/Network; application services เรียก Core ผ่าน typed commands เงินภาษีเก็บ SQLite เป็น integer satang ส่วนจำนวนเงิน/หน่วย/ราคา/FX ของพอร์ตเก็บเป็น decimal string ที่ตรวจสอบด้วย Rust

- [เอกสารผลิตภัณฑ์และการออกแบบ](docs/planning/README.md)
- [หลักฐานกฎและประเด็นที่ต้องยืนยัน](docs/planning/09-rule-versioning.md)
- [เกณฑ์ทดสอบและตรวจรับ](docs/planning/10-testing.md)
- [ความเป็นส่วนตัวและไฟล์สำรอง](docs/planning/11-security.md)
- [ผลทดสอบรุ่นทดลองและเกณฑ์ที่ยังเหลือ](docs/verification.md)
- [ขอบเขตและสัญญาข้อมูลพอร์ตลงทุน](docs/planning/13-wealth.md)

License: [Apache-2.0](LICENSE)
