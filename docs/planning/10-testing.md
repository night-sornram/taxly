# Testing Strategy และเกณฑ์ตรวจรับ

## Automated

- Rust unit/property tests: ทุก band และส่วนก่อน/หลังขอบ .01 บาท, ค่าใช้จ่าย, สิทธิ์, เครดิต, ปี, scope, precision และ overflow
- SQLite จริง: migrations, constraints, การแทน forecast, revision, การเปิดฐานข้อมูลใหม่ และปฏิเสธแก้ข้ามปี
- Backup จริง: age encryption, wrong password, corruption, format version, catalog hash, exact records/history/drafts และ rollback หลังลบ rows แล้วเกิด failure
- Frontend: decimal formatting/normalization ที่ไม่เสีย precision, labels และคำตอบ unknown
- Browser E2E: onboarding, CRUD, forecast replacement, restore review, responsive layout และ axe WCAG checks
- Contract fixture มาจาก Rust; มีการเทียบกับ engine ปัจจุบันเพื่อป้องกัน fixture ค้าง

## ตัวอย่าง 2568

โสดต่ำกว่า 65 ปี ใช้ส่วนตัว 60,000 ไม่มีสิทธิ์อื่น: รายได้ 360,000 สมทบ 9,000 -> ฐาน 191,000 -> ภาษี 2,050; เครดิต 3,000 -> preview เครดิตมากกว่าภาษี 950

รายได้ 600,000 สมทบ 9,000 -> ฐาน 431,000 -> ภาษี 20,600; เครดิต 18,000 -> preview ภาษีมากกว่าเครดิต 2,600

เงินเดือน 120,000 กับ 120,001 เปลี่ยนเฉพาะหน้าที่ยื่น ส่วนภาษียังเป็นศูนย์ รวม regression zero-tax แต่มีเครดิตขอคืนเชิงคำนวณ

## Native และ human release checklist

- เปิด bundle, กรอกข้อมูลสังเคราะห์, ตรวจผล, ปิดเปิดใหม่ แล้วข้อมูลอยู่ครบ
- ปิดการเข้าถึง Network ของ test harness และยืนยัน core flows ยังทำงาน; ไม่เปลี่ยน Wi-Fi ของผู้ใช้
- ตรวจ native file dialogs และการยกเลิกไม่เปลี่ยนข้อมูล
- ตรวจคีย์บอร์ด/AX tree; VoiceOver จริงยังต้องตรวจด้วยผู้ใช้
- ทดสอบ 5 ผู้ใช้ใหม่ เป้าหมาย 4 คนทำกรณีพื้นฐานได้ภายในประมาณ 5 นาที
- ยืนยัน rounding/กฎกับผู้ทบทวนภาษีก่อนเปิด settlement
- Apple signing/notarization ก่อนเผยแพร่ภายนอก

Browser IPC mock ไม่ใช่หลักฐานว่า native/SQLite/encryption ผ่าน ต้องอ่านผลแยกชั้น
