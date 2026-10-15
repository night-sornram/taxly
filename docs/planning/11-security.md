# Security และ Privacy

ข้อมูลอยู่ใน app data directory ของผู้ใช้ (`0700`) และฐานข้อมูล `0600` บน Unix SQLite เป็น plaintext ฐานข้อมูลและ WAL ต้องอยู่ใน private directory เดียวกัน

ไม่ขอ national ID ไม่สร้างบัญชี ไม่เก็บ analytics และไม่ส่ง crash data Core คำนวณไม่เรียก Network ฟอนต์และกฎอยู่ใน bundle การอัปเดตราคาลงทุน/FX ปิดไว้เริ่มต้นและเปิดใช้ได้ตามต้องการ Rust เรียก Yahoo ด้วยสัญลักษณ์และช่วงวันที่เท่านั้น ผู้ให้บริการเห็น IP ของผู้ใช้ ไม่ส่งชื่อบัญชีหรือประวัติการเงิน การเปิด source_id ที่ compile มากับแอปเรียก system browser

Production CSP อนุญาต bundled assets/IPC; ไม่มี frontend SQL, filesystem หรือ shell plugin permissions Application commands จำกัด main window ผ่าน AppManifest/capability

## Backup v2 และการอ่าน v1

v2 เก็บภาษีและการลงทุน รวมราคาที่เก็บไว้และ FX ใน snapshot เดียว การกู้คืน v2 แทนทั้งสองโมดูล atomically ส่วน v1 แทนเฉพาะภาษีโดยรักษาการลงทุนปัจจุบัน หน้าตรวจไฟล์ระบุขอบเขตและจำนวนบัญชี/กิจกรรมก่อนยืนยัน การลบข้อมูลล้างทั้งสองโมดูลและ cache ดูรายละเอียดที่ [Wealth module](13-wealth.md)

- JSON typed records/history/drafts และ trusted rule references
- age passphrase encryption, อย่างน้อย 12 ตัวอักษร ไม่สร้าง cryptography เอง
- Snapshot อ่านจาก transaction ที่สอดคล้องกัน; ไม่มี plaintext backup temp file
- ไฟล์ส่งออกเขียน encrypted temp แบบ private, sync แล้ว rename
- จำกัด plaintext 50 MiB/จำนวนรายการ 100,000 และตรวจ schema/relations/duplicates/rules/input hashes
- Inspect ถอดรหัสและตรวจในหน่วยความจำ คืน summary/token ให้ UI ตรวจ ก่อน Restore transaction แทน rows ทั้งชุด
- Cancel ล้าง pending payload; token ใช้ครั้งเดียวและปฏิเสธเมื่อเกิน 5 นาที
- Failure rollback รักษาข้อมูลเดิม มี test จำลอง failure หลังเริ่มแทนข้อมูล

ไม่เก็บรหัสผ่าน ไม่สามารถกู้คืนรหัสผ่าน ไม่มีการรับประกัน secure erase; ลบ records ไม่ได้ลบ backup ภายนอกหรือระบบสำรองของ OS

ขอบเขตป้องกันไม่ครอบคลุมผู้โจมตีที่เข้าถึง OS account เดียวกันได้ เก็บเงิน/รหัสผ่านออกจาก logs และทบทวน dependencies ก่อน release

## Dependency audit ณ 15 ตุลาคม 2569

`npm audit` ไม่พบช่องโหว่ทั้ง production และ development dependencies หลังอัปเดต test tooling

`cargo audit` ทั้ง lockfile ยังไม่ clean: พบ RUSTSEC-2023-0071 ใน `rsa 0.9.10` ที่มากับ optional MySQL driver ของ SQLx ผล `cargo tree --target aarch64-apple-darwin -i rsa` ไม่มี dependency นี้ใน macOS build แอปใช้เฉพาะ SQLite และ age ไม่ใช้ RSA หรือ MySQL

มี warnings เพิ่ม: glib 0.18.5 (Linux dependency ที่ไม่ได้ compile บน macOS), proc-macro-error และ proc-macro-error2 ที่ไม่ maintain โดย proc-macro-error2 เป็น build-time dependency ผ่าน i18n-embed-fl ของ age ไม่ใช่ runtime encryption API ยังไม่ได้เพิ่ม audit ignores และต้องทบทวน upstream ก่อนเพิ่มแพลตฟอร์ม/driver

ข้อมูลนี้ไม่ใช่คำรับรองว่าปลอดภัยทั้งหมด ควรตรวจ advisory database ใหม่ก่อนทุก release
