# Taxly

[English](#english) | [ภาษาไทย](#ภาษาไทย)

## English

A Thai tax assistant and personal income and expense tracker with local storage and optional real-time phone sync. Built with **Rust · Tauri 2 · React · TypeScript · Tailwind CSS · SQLite/SQLx**.

This experimental release supports single taxpayers under 65 with domestic salary or bonus income, multiple employers, the personal allowance, Section 33 social security contributions, and withholding tax credits for tax years **2025 / 2026 (B.E. 2568 / 2569)**.

### Getting started

Requires an Apple Silicon Mac, Xcode Command Line Tools, Rustup, and Node.js **24.12+ or 26+**. The Rust toolchain version is pinned in `rust-toolchain.toml`.

```sh
cd apps/desktop
npm ci
npm run tauri dev
```

Run the desktop app through Tauri for local SQLite and tax calculations. `npm run dev` also serves the phone ledger UI; configure Supabase and sign in to use it. No financial data is simulated. See [mobile sync setup](docs/mobile-sync.md) for the new Supabase project and HTTPS hosting.

Build a local experimental package:

```sh
cd apps/desktop
npm run tauri build -- --bundles app,dmg
```

Build output is in `target/release/bundle/`. Distribution requires Apple developer credentials for Developer ID signing and notarization. Automatic updates and publishing are not configured. Local experimental packages use ad hoc signing (`signingIdentity: "-"`), rather than an Apple Developer ID.

If DMG window customization hangs or times out, build with `CI=true npm run tauri -- build --bundles app,dmg` to skip Finder icon positioning.

### Features

**Income and expenses**

- Record income and expenses with a date, category, and note. Rename, add, or remove categories.
- Monthly summary of income, expenses, and the remaining balance, with spending by category and a 12-month table.
- Phone PWA with real-time account sync, offline entry storage, and explicit conflict choices. [Setup and limits](docs/mobile-sync.md).
- Mark an income entry as taxable to add it to the tax year's income (salary, bonus, or other one-time income, with withholding). Editing or deleting the entry updates the tax side too.
- Import bank or credit card CSV files (UTF-8 or Thai TIS-620). Pick the header row, match columns (one signed amount column or separate withdrawal/deposit columns), review every row, and skip likely duplicates.

**Taxes**

- Thai-language onboarding with saved progress so you can return later.
- Record salary, bonuses, and other one-time income. Keep actual and projected amounts separate, convert projections into actual entries, and add notes to each entry.
- Calculate withholding tax from gross amounts using common rates: 3% for contracted work, services, and advertising, or 5% for rent.
- Include other one-time income in full in estimates, with a notice that applicable expense deductions have not yet been applied.
- Unknown withholding tax is not treated as zero.
- Follow step-by-step calculations from the overview, with rule sources and saved calculation history.
- Review personal and social security allowances, with a list of allowances not yet supported in this release.

**Data and privacy**

- Expenses are not used as tax deductions; only income entries you mark as taxable reach the tax calculation.
- Back up tax and income/expense data in a password-encrypted file (v3). Older v1/v2 backups restore tax data only; investment data in v2 files is ignored. Clear all app data at any time.
- Fonts and rule sets are bundled with the app. Core features work offline.

### Experimental release limitations

**Final amounts payable or refundable are not available yet.** Intermediate rounding and refund handling still need confirmation with the Thai Revenue Department. Displayed differences are calculation results only. The 2026 rule set is provisional and must be checked against the annual guidance when published.

Support is incomplete for married taxpayers, people aged 65 or older, foreign income, lump-sum termination payments, special exemptions, and other allowances. The app discloses these limits before showing results. It does not file returns or pay taxes on your behalf.

The local database is **not encrypted**; access is restricted through per-user file permissions. Backup files are encrypted with a password of at least 12 characters. Tax features work without an account. Phone sync is opt-in: email sign-in and Supabase send ledger categories, entries, and tax-link settings to your project. Tax profiles and calculation history remain local. There are no usage analytics. Cloud data is not end-to-end encrypted; the project administrator can read it.

### Verification

From the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
```

From `apps/desktop`:

```sh
npm ci
npm run format:check
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests use the standard bridge interface and fixtures exported from Rust; they do not exercise SQLite or encryption in the browser. Rust tests exercise real SQLite databases and encrypted backups separately. Native UI testing must use the built macOS app.

When changing tax calculation behavior, review the rule sets and fixtures before regenerating the fixture:

```sh
TAXLY_EXPORT_FIXTURE=1 cargo test -p taxly-app export_contract_fixture_when_requested
```

Debug builds support `TAXLY_DATA_DIR` to isolate test data. Release builds ignore this variable.

### Architecture and documentation

`taxly-core` contains pure tax calculations without Tauri, SQLx, or network access. The app calls it through typed commands. Tax and income/expense amounts are stored as integer satang in SQLite.

- [Product and design documentation](docs/planning/README.md)
- [Rule evidence and open questions](docs/planning/09-rule-versioning.md)
- [Testing and acceptance criteria](docs/planning/10-testing.md)
- [Privacy and backups](docs/planning/11-security.md)
- [Experimental release verification and remaining criteria](docs/verification.md)

License: [Apache-2.0](LICENSE)

## ภาษาไทย

ผู้ช่วยภาษีไทยและบันทึกรายรับรายจ่ายที่เก็บข้อมูลไว้ในเครื่องของคุณทั้งหมด สร้างด้วย **Rust · Tauri 2 · React · TypeScript · Tailwind CSS · SQLite/SQLx**

รุ่นทดลองสำหรับผู้โสดอายุต่ำกว่า 65 ปี มีเงินเดือนหรือโบนัสในประเทศ รองรับหลายนายจ้าง สิทธิ์ลดหย่อนส่วนตัว ประกันสังคม ม.33 และเครดิตภาษีหัก ณ ที่จ่าย สำหรับปีภาษี **2568 / 2569**

### เริ่มต้นใช้งาน

ต้องมี macOS Apple Silicon, Xcode Command Line Tools, Rustup และ Node.js **24.12+ หรือ 26+** (ชุดเครื่องมือ Rust ตรึงเวอร์ชันไว้ใน `rust-toolchain.toml`)

```sh
cd apps/desktop
npm ci
npm run tauri dev
```

เปิดแอปผ่าน Tauri เพื่อใช้ SQLite และคำนวณภาษีในเครื่อง ส่วน `npm run dev` เปิดหน้ารายรับรายจ่ายสำหรับมือถือได้หลังตั้งค่า Supabase และเข้าบัญชี ไม่มีข้อมูลการเงินจำลอง ดู [การตั้งค่าซิงก์มือถือ](docs/mobile-sync.md) สำหรับโปรเจกต์ใหม่และโฮสต์ HTTPS

สร้างแพ็กเกจทดลองในเครื่อง:

```sh
cd apps/desktop
npm run tauri build -- --bundles app,dmg
```

ผลลัพธ์อยู่ที่ `target/release/bundle/` การแจกจ่ายจริงต้องเพิ่มข้อมูลนักพัฒนาของ Apple (ลงนามด้วย Developer ID และตรวจรับบัตรแอป) ระบบยังไม่มีการอัปเดตหรือเผยแพร่อัตโนมัติ แพ็กเกจทดลองใช้การลงนามชั่วคราวในเครื่อง (`signingIdentity: "-"`) ไม่ใช่ Developer ID ของ Apple

หากขั้นตกแต่งหน้าต่างของ DMG ค้างหรือหมดเวลา ให้สร้างด้วย `CI=true npm run tauri -- build --bundles app,dmg` เพื่อข้ามเฉพาะการจัดตำแหน่งไอคอนผ่าน Finder

### ความสามารถ

**รายรับรายจ่าย**

- บันทึกรายรับและรายจ่ายพร้อมวันที่ หมวดหมู่ และบันทึกช่วยจำ เพิ่ม เปลี่ยนชื่อ หรือลบหมวดหมู่ได้
- สรุปรายเดือน: รายรับ รายจ่าย คงเหลือ รายจ่ายตามหมวด และตารางทั้งปี
- ใช้ในโทรศัพท์แบบ PWA ซิงก์บัญชีแบบ real time เก็บรายการออฟไลน์และเลือกเมื่อข้อมูลแก้ชนกัน [วิธีตั้งค่าและขอบเขต](docs/mobile-sync.md)
- ติ๊กให้รายรับนับเป็นรายได้ในภาษีได้ (เงินเดือน โบนัส หรือรายได้อื่น พร้อมภาษีหัก ณ ที่จ่าย) แก้ไขหรือลบรายการแล้วฝั่งภาษีตามไปด้วย
- นำเข้า CSV จากธนาคารหรือบัตรเครดิต (UTF-8 หรือ TIS-620) เลือกแถวหัวตาราง จับคู่คอลัมน์ (คอลัมน์เดียวแบบติดลบ หรือแยกถอน/ฝาก) ตรวจทุกแถวก่อนบันทึก และข้ามรายการที่น่าจะซ้ำ

**ภาษี**

- ขั้นตอนเริ่มใช้งานเป็นภาษาไทย บันทึกความคืบหน้าไว้แล้วกลับมาทำต่อได้
- เงินเดือน โบนัส และรายได้อื่นแบบรับครั้งเดียว แยกยอดจริงกับยอดคาดการณ์ แก้ไขรายการคาดการณ์เดิมเป็นยอดจริงได้ พร้อมช่องบันทึกช่วยจำต่อรายการ
- ปุ่มคำนวณภาษีหัก ณ ที่จ่ายจากยอดก่อนหักในอัตราที่พบบ่อย 3% (ค่าจ้างทำของ ค่าบริการ ค่าโฆษณา) และ 5% (ค่าเช่า)
- รายได้อื่นที่รับครั้งเดียวนำเข้าการประมาณการแบบเต็มจำนวน พร้อมข้อความเปิดเผยว่ายังไม่หักค่าใช้จ่ายตามหลักเกณฑ์จริง
- ไม่สมมติภาษีหัก ณ ที่จ่ายที่ยังไม่ทราบเป็นศูนย์
- หน้าภาพรวมอธิบายการคำนวณทีละขั้น พร้อมแหล่งอ้างอิงกฎและประวัติผลการคำนวณ
- ผู้ช่วยตรวจสิทธิ์ลดหย่อนส่วนตัวและประกันสังคม พร้อมรายการสิทธิ์ที่ยังไม่รวมในรุ่นนี้

**ข้อมูลและความเป็นส่วนตัว**

- รายจ่ายไม่ถูกนำไปเป็นค่าลดหย่อนภาษี เฉพาะรายรับที่ติ๊กให้นับภาษีเท่านั้นที่เข้าการคำนวณ
- สำรองข้อมูลภาษีและรายรับรายจ่ายเป็นไฟล์เข้ารหัส (รูปแบบ v3) ด้วยรหัสผ่าน ไฟล์รุ่นเก่า v1/v2 กู้คืนเฉพาะข้อมูลภาษี (ข้อมูลการลงทุนในไฟล์ v2 จะถูกข้าม) และล้างข้อมูลทั้งแอปได้
- ฟอนต์และชุดกฎมาพร้อมกับแอป ใช้งานหลักได้แบบออฟไลน์

### ข้อจำกัดของรุ่นทดลอง

**ยังไม่เปิดยอดสำหรับชำระหรือขอคืนภาษี** เนื่องจากจุดปัดเศษระหว่างขั้นและวิธีจัดการยอดคืนยังต้องยืนยันกับกรมสรรพากร ผลส่วนต่างที่แสดงเป็นเพียงผลเชิงคำนวณ ชุดกฎปี 2569 ยังเป็นฉบับชั่วคราวและต้องเทียบกับคู่มือประจำปีเมื่อเผยแพร่

ผู้สมรส ผู้มีอายุ 65 ปีขึ้นไป รายได้จากต่างประเทศ เงินก้อนจากการออกจากงาน สิทธิ์ยกเว้นพิเศษ และสิทธิ์ลดหย่อนอื่นยังไม่รวมครบ แอปแจ้งขอบเขตเหล่านี้ก่อนแสดงผลเสมอ และไม่ยื่นแบบหรือชำระภาษีแทนผู้ใช้

ฐานข้อมูลในเครื่อง **ยังไม่เข้ารหัส** โดยป้องกันด้วยสิทธิ์ไฟล์เฉพาะผู้ใช้ของระบบ ส่วนไฟล์สำรองเข้ารหัสด้วยรหัสผ่านที่ยาวอย่างน้อย 12 ตัวอักษร ภาษีใช้ได้โดยไม่มีบัญชี หากเปิดซิงก์มือถือ ระบบใช้อีเมลเข้าบัญชีและส่งหมวดหมู่ รายรับรายจ่าย และตัวเลือกเชื่อมภาษีไปยัง Supabase ของคุณ โปรไฟล์ภาษีและประวัติผลคำนวณยังอยู่ในเครื่อง ไม่มีสถิติการใช้งาน ข้อมูลออนไลน์ไม่ได้เข้ารหัสแบบปลายทางถึงปลายทาง ผู้ดูแลโปรเจกต์อ่านได้

### การตรวจสอบ

จากไดเรกทอรีหลักของโปรเจกต์:

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

การทดสอบในเบราว์เซอร์ใช้ตัวเชื่อมมาตรฐานและข้อมูลตัวอย่างที่ส่งออกจากโค้ด Rust จึงไม่ได้ทดสอบ SQLite หรือการเข้ารหัสผ่านเบราว์เซอร์ ส่วนการทดสอบฝั่ง Rust ใช้ SQLite จริงและไฟล์สำรองเข้ารหัสจริงแยกกัน การทดสอบแอปจริงบนหน้าจอต้องทำกับแอป macOS ที่สร้างแล้ว

เมื่อแก้พฤติกรรมของตัวคำนวณภาษี ต้องทบทวนชุดกฎและไฟล์ข้อมูลตัวอย่างก่อน จึงจะสร้างไฟล์ตัวอย่างใหม่ได้:

```sh
TAXLY_EXPORT_FIXTURE=1 cargo test -p taxly-app export_contract_fixture_when_requested
```

รุ่นสำหรับหาข้อผิดพลาด (debug) รองรับตัวแปร `TAXLY_DATA_DIR` เพื่อแยกข้อมูลสำหรับทดสอบ ส่วนรุ่นสำหรับเผยแพร่ (release) ไม่อ่านตัวแปรนี้

### โครงสร้างและเอกสาร

`taxly-core` เป็นตัวคำนวณภาษีล้วน ไม่เชื่อมต่อ Tauri, SQLx หรือเครือข่าย ส่วนของแอปเรียกใช้ผ่านคำสั่งที่กำหนดชนิดข้อมูลชัดเจน ข้อมูลภาษีและรายรับรายจ่ายเก็บเป็นจำนวนเต็มสตางค์ใน SQLite

- [เอกสารผลิตภัณฑ์และการออกแบบ](docs/planning/README.md)
- [หลักฐานกฎและประเด็นที่ต้องยืนยัน](docs/planning/09-rule-versioning.md)
- [เกณฑ์ทดสอบและตรวจรับ](docs/planning/10-testing.md)
- [ความเป็นส่วนตัวและไฟล์สำรอง](docs/planning/11-security.md)
- [ผลทดสอบรุ่นทดลองและเกณฑ์ที่ยังเหลือ](docs/verification.md)

สัญญาอนุญาตใช้งาน: [Apache-2.0](LICENSE)
