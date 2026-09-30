-- ========================================================
-- FireTank Database Schema for Cloudflare D1 (SQLite)
-- ========================================================

-- ตารางข้อมูลถังดับเพลิง
CREATE TABLE IF NOT EXISTS tanks (
    fire_tank TEXT PRIMARY KEY,
    types TEXT,
    weight REAL,
    area TEXT,
    inuse TEXT,
    lastcheck TEXT,
    tankcheck TEXT DEFAULT 'ยังไม่เช็ค',
    ready_or_not TEXT DEFAULT 'Not Ready',
    tank_status INTEGER DEFAULT 0,
    exptank TEXT,
    pic_tank TEXT,
    pic_area TEXT,
    inspector TEXT,
    responsible TEXT,
    remark TEXT DEFAULT ''
);

-- ตารางผู้ใช้งานที่ได้รับอนุมัติแล้ว
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    rank TEXT DEFAULT 'P1',
    permit_do INTEGER DEFAULT 1,
    em_name TEXT NOT NULL
);

-- ตารางผู้ลงทะเบียนรอการอนุมัติจาก Admin
CREATE TABLE IF NOT EXISTS pending_users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    em_name TEXT NOT NULL,
    rank TEXT DEFAULT 'P1',
    permit_do INTEGER DEFAULT 1,
    registered_at TEXT NOT NULL
);

-- ดัชนีเพื่อเพิ่มความเร็วในการค้นหา
CREATE INDEX IF NOT EXISTS idx_tanks_area ON tanks(area);
CREATE INDEX IF NOT EXISTS idx_tanks_type ON tanks(types);
CREATE INDEX IF NOT EXISTS idx_tanks_status ON tanks(tankcheck, ready_or_not);

-- ========================================================
-- Migration: สำหรับ DB ที่สร้างก่อนหน้านี้แล้ว
-- รันคำสั่งนี้ใน Cloudflare D1 Console ถ้า table tanks มีอยู่แล้ว
-- ALTER TABLE tanks ADD COLUMN responsible TEXT DEFAULT '';
-- ALTER TABLE tanks ADD COLUMN remark TEXT DEFAULT '';
-- ========================================================
