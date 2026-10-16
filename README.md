# Taxly

[English](#english) | [ภาษาไทย](#ภาษาไทย)

## English

A Thai tax assistant and investment portfolio tracker that stores all your data on your device. Built with **Rust · Tauri 2 · React · TypeScript · Tailwind CSS · SQLite/SQLx**.

This experimental release supports single taxpayers under 65 with domestic salary or bonus income, multiple employers, the personal allowance, Section 33 social security contributions, and withholding tax credits for tax years **2025 / 2026 (B.E. 2568 / 2569)**.

### Getting started

Requires an Apple Silicon Mac, Xcode Command Line Tools, Rustup, and Node.js **24.12+ or 26+**. The Rust toolchain version is pinned in `rust-toolchain.toml`.

```sh
cd apps/desktop
npm ci
npm run tauri dev
```

Run the desktop app through Tauri to use the database. `npm run dev` starts only the frontend, which displays instructions to open the desktop app. The production frontend does not simulate financial data.

Build a local experimental package:

```sh
cd apps/desktop
npm run tauri build -- --bundles app,dmg
```

Build output is in `target/release/bundle/`. Distribution requires Apple developer credentials for Developer ID signing and notarization. Automatic updates and publishing are not configured. Local experimental packages use ad hoc signing (`signingIdentity: "-"`), rather than an Apple Developer ID.

If DMG window customization hangs or times out, build with `CI=true npm run tauri -- build --bundles app,dmg` to skip Finder icon positioning.

### Features

**Investments**

- Track stocks, ETFs, and cash in multiple currencies across accounts. Record trades and calculate first-in, first-out (FIFO) cost basis and time-weighted returns (TWR).
- Start with a complete transaction history or opening balances. Import CSV files with duplicate detection and automatic column matching.
- Search Yahoo Finance for securities and automatically fill in the name, exchange, type, and symbol. Market data must be enabled first.
- Record purchases using a total amount and let the app calculate the unit price. Preview profit or loss against the latest price, or use the latest stored price directly.
- Record prices and exchange rates manually, or optionally fetch them from Yahoo Finance. Data is cached locally for offline use.
- When market data is enabled, stock and ETF logos load directly from Financial Modeling Prep by symbol. Initials appear when market data is disabled or no image is available.

**Taxes**

- Thai-language onboarding with saved progress so you can return later.
- Record salary, bonuses, and other one-time income. Keep actual and projected amounts separate, convert projections into actual entries, and add notes to each entry.
- Calculate withholding tax from gross amounts using common rates: 3% for contracted work, services, and advertising, or 5% for rent.
- Include other one-time income in full in estimates, with a notice that applicable expense deductions have not yet been applied.
- Unknown withholding tax is not treated as zero.
- Follow step-by-step calculations from the overview, with rule sources and saved calculation history.
- Review personal and social security allowances, with a list of allowances not yet supported in this release.

**Data and privacy**

- Investment results are kept separate from tax calculations and are not included in taxable income.
- Back up tax and investment data in a password-encrypted file (v2). Restore older tax-only v1 backups, or clear all app data.
- Fonts and rule sets are bundled with the app. Core features work offline.

### Experimental release limitations

**Final amounts payable or refundable are not available yet.** Intermediate rounding and refund handling still need confirmation with the Thai Revenue Department. Displayed differences are calculation results only. The 2026 rule set is provisional and must be checked against the annual guidance when published.

Support is incomplete for married taxpayers, people aged 65 or older, foreign income, lump-sum termination payments, special exemptions, and other allowances. The app discloses these limits before showing results. It does not file returns or pay taxes on your behalf.

The local database is **not encrypted**; access is restricted through per-user file permissions. Backup files are encrypted with a password of at least 12 characters. There are no user accounts, usage analytics, or cloud sync. Market data is optional and disabled by default. When enabled, Yahoo Finance receives the requested symbols and your IP address. Financial Modeling Prep receives symbols and your IP address when security logos load. Market prices may be delayed or incomplete.

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

`taxly-core` and `wealth-core` contain pure calculations without Tauri, SQLx, or network access. The app calls them through typed commands. Tax amounts are stored as integer satang in SQLite. Portfolio amounts, quantities, prices, and exchange rates are stored as decimal strings and validated by Rust on every use.

- [Product and design documentation](docs/planning/README.md)
- [Rule evidence and open questions](docs/planning/09-rule-versioning.md)
- [Testing and acceptance criteria](docs/planning/10-testing.md)
- [Privacy and backups](docs/planning/11-security.md)
- [Experimental release verification and remaining criteria](docs/verification.md)
- [Investment scope and data contracts](docs/planning/13-wealth.md)

License: [Apache-2.0](LICENSE)

## ภาษาไทย

ผู้ช่วยภาษีไทยและติดตามพอร์ตลงทุนที่เก็บข้อมูลไว้ในเครื่องของคุณทั้งหมด สร้างด้วย **Rust · Tauri 2 · React · TypeScript · Tailwind CSS · SQLite/SQLx**

รุ่นทดลองสำหรับผู้โสดอายุต่ำกว่า 65 ปี มีเงินเดือนหรือโบนัสในประเทศ รองรับหลายนายจ้าง สิทธิ์ลดหย่อนส่วนตัว ประกันสังคม ม.33 และเครดิตภาษีหัก ณ ที่จ่าย สำหรับปีภาษี **2568 / 2569**

### เริ่มต้นใช้งาน

ต้องมี macOS Apple Silicon, Xcode Command Line Tools, Rustup และ Node.js **24.12+ หรือ 26+** (ชุดเครื่องมือ Rust ตรึงเวอร์ชันไว้ใน `rust-toolchain.toml`)

```sh
cd apps/desktop
npm ci
npm run tauri dev
```

ต้องเปิดแอปจริงผ่าน Tauri จึงจะใช้ฐานข้อมูลได้ ส่วน `npm run dev` เปิดเฉพาะส่วนหน้าจอ และจะแสดงคำแนะนำให้เปิดแอปเดสก์ท็อปแทน ไม่มีการจำลองข้อมูลการเงินในส่วนหน้าจอรุ่นที่ใช้งานจริง

สร้างแพ็กเกจทดลองในเครื่อง:

```sh
cd apps/desktop
npm run tauri build -- --bundles app,dmg
```

ผลลัพธ์อยู่ที่ `target/release/bundle/` การแจกจ่ายจริงต้องเพิ่มข้อมูลนักพัฒนาของ Apple (ลงนามด้วย Developer ID และตรวจรับบัตรแอป) ระบบยังไม่มีการอัปเดตหรือเผยแพร่อัตโนมัติ แพ็กเกจทดลองใช้การลงนามชั่วคราวในเครื่อง (`signingIdentity: "-"`) ไม่ใช่ Developer ID ของ Apple

หากขั้นตกแต่งหน้าต่างของ DMG ค้างหรือหมดเวลา ให้สร้างด้วย `CI=true npm run tauri -- build --bundles app,dmg` เพื่อข้ามเฉพาะการจัดตำแหน่งไอคอนผ่าน Finder

### ความสามารถ

**การลงทุน**

- พอร์ตหุ้นและ ETF พร้อมเงินสดหลายสกุลเงิน แยกตามบัญชี บันทึกการซื้อขาย คำนวณต้นทุนแบบเข้าก่อน-ออกก่อน (FIFO) และผลตอบแทนถ่วงน้ำหนักตามเวลา (TWR)
- เริ่มด้วยประวัติรายการทั้งหมด หรือยอดยกมา นำเข้าไฟล์ CSV พร้อมตรวจรายการซ้ำและจับคู่คอลัมน์ให้อัตโนมัติ
- ค้นหาหลักทรัพย์จาก Yahoo Finance แล้วกรอกชื่อ ตลาด ประเภท และสัญลักษณ์ให้อัตโนมัติ (ต้องเปิดข้อมูลตลาดก่อน)
- บันทึกการซื้อด้วยยอดเงินรวมได้เลย ระบบคำนวณราคาต่อหน่วยให้ พร้อมพรีวิวกำไรขาดทุนทันทีเทียบราคาล่าสุด และมีปุ่มใช้ราคาล่าสุดในระบบ
- บันทึกราคาและอัตราแลกเปลี่ยนเองได้ หรือเปิดดึงข้อมูลจาก Yahoo Finance เมื่อต้องการ ข้อมูลถูกเก็บไว้ในเครื่องเพื่อเปิดดูแบบออฟไลน์
- โลโก้หุ้นและ ETF โหลดตรงจาก Financial Modeling Prep ตามสัญลักษณ์เมื่อเปิดข้อมูลตลาด หากปิดอยู่หรือไม่มีรูปจะแสดงอักษรย่อแทน

**ภาษี**

- ขั้นตอนเริ่มใช้งานเป็นภาษาไทย บันทึกความคืบหน้าไว้แล้วกลับมาทำต่อได้
- เงินเดือน โบนัส และรายได้อื่นแบบรับครั้งเดียว แยกยอดจริงกับยอดคาดการณ์ แก้ไขรายการคาดการณ์เดิมเป็นยอดจริงได้ พร้อมช่องบันทึกช่วยจำต่อรายการ
- ปุ่มคำนวณภาษีหัก ณ ที่จ่ายจากยอดก่อนหักในอัตราที่พบบ่อย 3% (ค่าจ้างทำของ ค่าบริการ ค่าโฆษณา) และ 5% (ค่าเช่า)
- รายได้อื่นที่รับครั้งเดียวนำเข้าการประมาณการแบบเต็มจำนวน พร้อมข้อความเปิดเผยว่ายังไม่หักค่าใช้จ่ายตามหลักเกณฑ์จริง
- ไม่สมมติภาษีหัก ณ ที่จ่ายที่ยังไม่ทราบเป็นศูนย์
- หน้าภาพรวมอธิบายการคำนวณทีละขั้น พร้อมแหล่งอ้างอิงกฎและประวัติผลการคำนวณ
- ผู้ช่วยตรวจสิทธิ์ลดหย่อนส่วนตัวและประกันสังคม พร้อมรายการสิทธิ์ที่ยังไม่รวมในรุ่นนี้

**ข้อมูลและความเป็นส่วนตัว**

- ผลการลงทุนแยกจากการคำนวณภาษี ยังไม่นำไปรวมในฐานภาษี
- สำรองข้อมูลทั้งภาษีและการลงทุนเป็นไฟล์เข้ารหัส (รูปแบบ v2) ด้วยรหัสผ่าน กู้คืนไฟล์รุ่นเก่า v1 ที่เก็บเฉพาะข้อมูลภาษีได้ และล้างข้อมูลทั้งแอปได้
- ฟอนต์และชุดกฎมาพร้อมกับแอป ใช้งานหลักได้แบบออฟไลน์

### ข้อจำกัดของรุ่นทดลอง

**ยังไม่เปิดยอดสำหรับชำระหรือขอคืนภาษี** เนื่องจากจุดปัดเศษระหว่างขั้นและวิธีจัดการยอดคืนยังต้องยืนยันกับกรมสรรพากร ผลส่วนต่างที่แสดงเป็นเพียงผลเชิงคำนวณ ชุดกฎปี 2569 ยังเป็นฉบับชั่วคราวและต้องเทียบกับคู่มือประจำปีเมื่อเผยแพร่

ผู้สมรส ผู้มีอายุ 65 ปีขึ้นไป รายได้จากต่างประเทศ เงินก้อนจากการออกจากงาน สิทธิ์ยกเว้นพิเศษ และสิทธิ์ลดหย่อนอื่นยังไม่รวมครบ แอปแจ้งขอบเขตเหล่านี้ก่อนแสดงผลเสมอ และไม่ยื่นแบบหรือชำระภาษีแทนผู้ใช้

ฐานข้อมูลในเครื่อง **ยังไม่เข้ารหัส** โดยป้องกันด้วยสิทธิ์ไฟล์เฉพาะผู้ใช้ของระบบ ส่วนไฟล์สำรองเข้ารหัสด้วยรหัสผ่านที่ยาวอย่างน้อย 12 ตัวอักษร ไม่มีบัญชีผู้ใช้ ไม่มีการเก็บสถิติการใช้งาน และไม่มีการซิงก์ผ่านคลาวด์ การดึงข้อมูลตลาดเป็นตัวเลือกและปิดไว้ตั้งแต่ติดตั้ง เมื่อเปิดใช้ Yahoo Finance จะทราบสัญลักษณ์ที่ขอและที่อยู่ IP ของผู้ใช้ ส่วน Financial Modeling Prep จะทราบสัญลักษณ์และ IP เมื่อโหลดโลโก้หลักทรัพย์ ราคาที่ได้อาจล่าช้าหรือไม่ครบถ้วน

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

`taxly-core` และ `wealth-core` เป็นตัวคำนวณล้วน ไม่เชื่อมต่อ Tauri, SQLx หรือเครือข่าย ส่วนของแอปเรียกใช้ผ่านคำสั่งที่กำหนดชนิดข้อมูลชัดเจน ข้อมูลภาษีเก็บเป็นจำนวนเต็มสตางค์ใน SQLite ส่วนจำนวนเงิน หน่วย ราคา และอัตราแลกเปลี่ยนของพอร์ตเก็บเป็นข้อความทศนิยมที่ตรวจสอบความถูกต้องด้วย Rust ทุกครั้ง

- [เอกสารผลิตภัณฑ์และการออกแบบ](docs/planning/README.md)
- [หลักฐานกฎและประเด็นที่ต้องยืนยัน](docs/planning/09-rule-versioning.md)
- [เกณฑ์ทดสอบและตรวจรับ](docs/planning/10-testing.md)
- [ความเป็นส่วนตัวและไฟล์สำรอง](docs/planning/11-security.md)
- [ผลทดสอบรุ่นทดลองและเกณฑ์ที่ยังเหลือ](docs/verification.md)
- [ขอบเขตและสัญญาข้อมูลพอร์ตลงทุน](docs/planning/13-wealth.md)

สัญญาอนุญาตใช้งาน: [Apache-2.0](LICENSE)
