# SQLite Schema

Schema ที่รันจริงอยู่ใน migrations/0001_initial.sql และ 0002_source_identity.sql ทุกตารางเป็น STRICT

| Table | หน้าที่ |
|---|---|
| tax_years | facts JSON, completion state, revision และ timestamps |
| income_sources | employer label แยกปี มี unique year/label |
| income_entries | เดือน salary/bonus, actual/forecast, gross satang, nullable withholding |
| deduction_entries | sso_33 รวมรายเดือน หนึ่งรายการต่อปี/เดือน |
| rule_sets | immutable payload, version, hash และสถานะตรวจ |
| calculation_snapshots | immutable input/output, engine/rule versions, hash และ revision |
| app_settings | questionnaire draft แยกปีและปีที่ใช้ล่าสุด |

เงินทั้งหมดใน record ใช้ INTEGER satang ค่าระหว่างคำนวณใน snapshot JSON ใช้ decimal string ห้าม REAL/NUMERIC

Foreign key ของ income source บังคับปีเดียวกับ record; partial unique index ป้องกันเงินเดือนซ้ำ source/month ส่วน bonus มีหลายรายการได้

ใช้ WAL, synchronous FULL, foreign keys ทุก connection และ busy timeout 5 วินาที ฐานข้อมูลมี pool สูงสุด 2 connections

การลบ record ยกเลิกการยืนยันครบปี การลบเงินสมทบยกเลิกการยืนยันประกันสังคมด้วย ประวัติเก่าไม่ถูกแก้ตามยอดปัจจุบัน
