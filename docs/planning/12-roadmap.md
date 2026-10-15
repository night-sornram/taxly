# Roadmap และสถานะส่งมอบ

## MVP ที่พัฒนาในครั้งนี้

Salary core -> Tauri/SQLite -> onboarding/dashboard -> tracker/forecast -> assistant/sources/history -> encrypted backup/restore -> tests/CI/macOS bundle

## ยังเป็นเงื่อนไข release

1. ผู้ทบทวนภาษียืนยันจุดปัดเศษและยอดคืน พร้อม official comparison fixtures
2. ตรวจชุดกฎ 2569 กับเอกสารประจำปีเมื่อเผยแพร่
3. ทดสอบผู้ใช้ใหม่ 5 คน และ VoiceOver บนเครื่องจริง
4. Apple Developer signing/notarization และการแจกจ่ายภายนอก

อย่าเปลี่ยนสถานะเป็น approved tax filing tool จากการที่ build/tests ผ่าน App ยังเป็นเครื่องมือประมาณการ

## หลัง MVP

- เพิ่มประกัน ครอบครัว กองทุน บ้าน บริจาคทีละกลุ่ม พร้อม shared caps/เงื่อนไขเฉพาะปี
- เพิ่ม 40(2) แล้วเงินได้ผสมและวิธี 0.5% อย่าจัดฟรีแลนซ์ทุกคนเป็นมาตราเดียว
- เพิ่ม 40(3)–(8) ทีละประเภท รวม final-tax choices, actual expenses และครึ่งปีตามที่เกี่ยวข้อง
- Windows/Linux หลัง native packaging tests; ทดลอง Android/iOS โดยใช้ Core เดิม

ไม่มี commitment ว่าครอบคลุม foreign income หรือยื่นแบบอัตโนมัติจนกว่าจะมีขอบเขตและ official integration ที่รองรับจริง
