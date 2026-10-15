# Tax Engine Domain Model

`calculate(&AnnualTaxInput, &TaxRuleSet) -> Result<TaxCalculation, TaxError>`

Input ประกอบด้วยปี ข้อเท็จจริงผู้เสียภาษี เงินได้ เครดิตแต่ละรายการ เงินสมทบรายเดือน และการยืนยันความครบถ้วน

Money รับ input ไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง ในช่วง i64 satang ส่วนค่าระหว่างคำนวณเก็บ precision เพิ่มได้ ผลทุกจำนวน serialize เป็น string

IncomeCategory มีชื่อ 40(1)–40(8) แต่ engine รุ่นนี้คืน UnsupportedCategory สำหรับทุกประเภทนอก 40(1)

## ลำดับ

รวมรายได้ -> ค่าใช้จ่าย 50% ภายใต้เพดานรวมต่อคน -> สิทธิ์ส่วนตัว -> ประกันสังคมที่เข้าเงื่อนไข -> เงินได้สุทธิขั้นต่ำศูนย์ -> ภาษีแต่ละขั้น -> เครดิตภาษี

ภาษีหัก ณ ที่จ่ายไม่ใช่ลดหย่อน และการหักจากหลายนายจ้างไม่ทำให้ได้เพดานค่าใช้จ่ายเพิ่ม

ผลแยก data completeness, basis และ rules status มี CalculationStep พร้อม rule/source IDs และผลแต่ละ band

FilingAssessment เป็น required/not_required/undetermined แยกจากภาษี Difference preview เป็นผลเชิงคำนวณ ส่วน settlement ถูกปิดไว้จนผ่าน regulatory gate
