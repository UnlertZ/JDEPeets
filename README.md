# 🔥 FireTank — ระบบตรวจเช็คและบริหารจัดการถังดับเพลิงออนไลน์ (Cloudflare Pages Ready)

เว็บแอปพลิเคชัน Static Web App สำหรับบันทึกและตรวจเช็คสภาพถังดับเพลิงประจำเดือน รองรับการนำขึ้น **Cloudflare Pages** และ **GitHub Pages** ได้ทันที 100% โดยไม่ต้องติดตั้งเซิร์ฟเวอร์หรือฐานข้อมูลภายนอก

---

## ✨ คุณสมบัติของเวอร์ชัน Static Web App

1. **ไม่ต้องมี Python Server**: ทุกหน้าทำงานบนเบราว์เซอร์ผ่าน HTML5, CSS3, JavaScript (ES6)
2. **ฐานข้อมูลเริ่มต้นครบถ้วน**: มีข้อมูลถังดับเพลิงครบทั้ง 116 ถัง (สกัดจาก Excel `FirePump.xlsx`) พร้อมรูปถ่ายเดิม
3. **ฟังก์ชันเหมือนเดิม 100%**:
   - หน้า **Dashboard**: การ์ดสรุป 4 มิติ, ตัวกรอง, ค้นหา, ตาราง DataTables ภาษาไทย
   - หน้า **ตรวจเช็คสภาพถัง** (`check.html`): 4 รายการตรวจ, ประเมินสถานะอัตโนมัติ, แนบรูปถ่าย (Base64), บันทึกชื่อผู้ตรวจและวันเวลา
   - ระบบ **สิทธิ์ผู้ใช้งาน** (`login.html`):
     - `Guest`: ดูข้อมูลได้อย่างเดียว
     - `P1` (`LeaderLinePD1` / `PD1`): สิทธิ์ตรวจเช็คสภาพถัง
     - `P2` (`johporadmin` / `Admin0123456789`): สิทธิ์เต็ม (ตรวจเช็ค, เพิ่ม, แก้ไข, ลบ)
4. **Export & Import Excel (.xlsx)**: มีปุ่มดาวน์โหลดฐานข้อมูลเป็นไฟล์ Excel จริงผ่าน SheetJS เพื่อเปิดใน Microsoft Excel ได้ตลอดเวลา

---

## ☁️ วิธีนำขึ้น Cloudflare Pages (ง่ายที่สุดใน 1 นาที)

### วิธีที่ 1: Direct Upload ผ่านหน้าเว็บ (ไม่ต้องใช้ Git)
1. ไปที่เว็บไซต์ **[Cloudflare Dashboard](https://dash.cloudflare.com/)** แล้วเข้าเมนู **Workers & Pages**
2. กดปุ่ม **Create application** ➔ เลือกแท็บ **Pages**
3. เลือก **Upload assets**
4. ตั้งชื่อโปรเจกต์ เช่น `firetank`
5. **ลากโฟลเดอร์โปรเจกต์นี้ทั้งหมด** (`FireTankProject`) ใส่ลงในช่องอัปโหลดของ Cloudflare
6. กด **Deploy site** ➔ ระบบจะสร้างลิงก์เว็บไซต์ให้ทันที เช่น `https://firetank.pages.dev` ใช้งานได้ทั่วโลกทันที!

### วิธีที่ 2: เชื่อมต่อผ่าน GitHub
1. นำโค้ดขึ้น GitHub Repository
2. ใน Cloudflare Pages เลือก **Connect to Git** แล้วเลือก Repo ของคุณ
3. ในส่วน Build settings:
   - **Framework preset**: `None`
   - **Build command**: *(เว้นว่างไว้)*
   - **Build output directory**: `/` *(หรือเว้นว่างไว้)*
4. กด **Save and Deploy**

---

## 📁 โครงสร้างโปรเจค (Static Structure)

```
FireTankProject/
├── index.html                   # หน้าแดชบอร์ดหลัก (Dashboard & DataTables)
├── check.html                   # หน้าตรวจเช็คสภาพถังดับเพลิง
├── login.html                   # หน้าเข้าสู่ระบบ
├── add.html                     # หน้าเพิ่มถังใหม่ (เฉพาะ P2)
├── edit.html                    # หน้าแก้ไขข้อมูลถัง (เฉพาะ P2)
├── css/
│   └── style.css                # CSS สไตล์โมเดิร์นธีมความปลอดภัย/สีแดง
├── js/
│   ├── initial_data.js          # ข้อมูลตั้งต้น 116 ถัง และบัญชีผู้ใช้
│   ├── storage.js               # จัดการ LocalStorage และ SheetJS Excel Export/Import
│   └── auth.js                  # ระบบยืนยันตัวตนและควบคุมสิทธิ์
└── static/uploads/              # ไฟล์รูปภาพถังเดิมและพื้นที่
```

---

## 👥 บัญชีสำหรับทดสอบระบบ

| บทบาท | Username | Password | ชื่อพนักงาน | สิทธิ์ |
|---|---|---|---|---|
| **Admin (P2)** | `johporadmin` | `Admin0123456789` | Halls | ตรวจเช็ค, เพิ่ม, แก้ไข, ลบ |
| **User (P1)** | `LeaderLinePD1` | `PD1` | Jort | ตรวจเช็คสภาพถัง |
