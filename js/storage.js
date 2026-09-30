/**
 * storage.js — ตัวจัดการฐานข้อมูล Dual-Mode (Cloudflare D1 SQL API + LocalStorage Fallback)
 * รองรับการเชื่อมต่อ SQL บน Cloudflare แบบ Realtime และมี SheetJS สำหรับ Export Excel (สิทธิ์ P2)
 */

const STORAGE_KEY = 'firetank_tanks_data';
let isCloudflareD1Active = null; // null: ยังไม่ได้เช็ค, true: ใช้ D1 SQL, false: ใช้ LocalStorage

// Helper: สกัดปี 4 หลัก
function extractYear(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length >= 3 && /^\d{4}/.test(parts[2])) {
      return parseInt(parts[2].slice(0, 4), 10);
    }
  }
  if (s.includes('-')) {
    const parts = s.split('-');
    if (/^\d{4}$/.test(parts[0])) {
      return parseInt(parts[0], 10);
    }
  }
  const digits = s.match(/\d{4}/);
  return digits ? parseInt(digits[0], 10) : null;
}

// Helper: ฟอร์แมตวันที่เริ่มใช้เป็น 01/01/YYYY
function formatInuseDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }
  const y = extractYear(val);
  if (y) return `01/01/${y}`;
  return s;
}

// Helper: คำนวณอายุถัง เช่น "5ปี"
function calculateExptank(inuse, lastcheck) {
  const inuseYear = extractYear(inuse);
  const lastYear = extractYear(lastcheck) || new Date().getFullYear();
  if (inuseYear !== null) {
    const diff = Math.max(0, lastYear - inuseYear);
    return `${diff}ปี`;
  }
  return '';
}

// Helper: คำนวณจำนวนวันที่ผ่านไปนับจากวันตรวจล่าสุด (รองรับ DD/MM/YYYY, YYYY-MM-DD, HH:mm)
function getDaysSinceCheck(lastcheckVal) {
  if (!lastcheckVal) return null;
  const s = String(lastcheckVal).trim();
  if (!s) return null;

  let checkDate = null;
  // รูปแบบ 1: DD/MM/YYYY หรือ DD-MM-YYYY (เช่น "01/01/2026" หรือ "01/02/2026 14:30")
  if (/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.test(s)) {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      const h = m[4] ? parseInt(m[4], 10) : 0;
      const mi = m[5] ? parseInt(m[5], 10) : 0;
      checkDate = new Date(y, mo, d, h, mi);
    }
  }
  // รูปแบบ 2: YYYY-MM-DD หรือ YYYY/MM/DD (เช่น "2026-09-29 17:57" หรือ "2026-01-01")
  else if (/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.test(s)) {
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      const h = m[4] ? parseInt(m[4], 10) : 0;
      const mi = m[5] ? parseInt(m[5], 10) : 0;
      checkDate = new Date(y, mo, d, h, mi);
    }
  }

  if (!checkDate || isNaN(checkDate.getTime())) {
    return null;
  }

  const now = new Date();
  const diffMs = now.getTime() - checkDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Helper: ตรวจสอบว่าผลการตรวจเกิน 30 วันหรือไม่
function isCheckExpired(lastcheckVal, daysThreshold = 30) {
  const days = getDaysSinceCheck(lastcheckVal);
  if (days === null) return false;
  return days >= daysThreshold;
}

// Helper: บังคับใช้กฎ 30 วัน — ถ้าตรวจล่าสุดเกิน 30 วันแล้ว ให้เปลี่ยนจาก 'เช็คแล้ว' เป็น 'ยังไม่เช็ค'
function applyThirtyDaysRule(tank) {
  if (!tank) return tank;
  if (tank.Tankcheck === 'เช็คแล้ว') {
    const days = getDaysSinceCheck(tank.Lastcheck);
    if (days !== null && days >= 30) {
      tank.Tankcheck = 'ยังไม่เช็ค';
      tank.IsExpired30Days = true;
      tank.DaysSinceCheck = days;
    }
  }
  return tank;
}

// Helper: สร้าง Sort Key สำหรับเรียงลำดับรหัสถังแบบตัวเลขธรรมชาติ เช่น "EX1" -> "EX00000001", "EX11" -> "EX00000011", "EX100" -> "EX00000100"
function getTankSortKey(fireTankId) {
  if (!fireTankId) return '';
  const s = String(fireTankId).trim();
  const m = s.match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    return `${m[1].toUpperCase()}${String(m[2]).padStart(8, '0')}`;
  }
  return s;
}

// Helper: บีบอัดรูปภาพก่อนส่งเข้า D1 SQL (ความกว้างไม่เกิน 1200px, JPEG quality 0.75)
function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(event) {
      const img = new Image();
      img.src = event.target.result;
      img.onload = function() {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function(err) { resolve(event.target.result); };
    };
    reader.onerror = function(err) { reject(err); };
  });
}

// ─── ตรวจสอบการเชื่อมต่อ Cloudflare D1 ───
async function checkD1Connection() {
  if (isCloudflareD1Active !== null) return isCloudflareD1Active;
  try {
    const res = await fetch('api/tanks', { method: 'GET' });
    if (res.ok) {
      isCloudflareD1Active = true;
      return true;
    }
  } catch (e) {}
  isCloudflareD1Active = false;
  return false;
}

// ─── ดึงรายการถังทั้งหมด (Async รองรับ D1 SQL) ───
async function fetchAllTanks() {
  const isD1 = await checkD1Connection();
  if (isD1) {
    try {
      const res = await fetch('api/tanks');
      if (res.ok) {
        let data = await res.json();
        // หาก D1 มีข้อมูล ให้ใช้ข้อมูลจาก D1 และซิงก์ลงแคช
        if (Array.isArray(data) && data.length > 0) {
          data = data.map(applyThirtyDaysRule);
          saveAllTanks(data);
          return data;
        }
      }
    } catch (e) {
      console.warn('D1 fetch failed, falling back to local storage', e);
    }
  }
  return getAllTanks();
}

// ดึงจาก LocalStorage (Synchronous)
function getAllTanks() {
  const data = localStorage.getItem(STORAGE_KEY);
  let tanks = [];
  if (data) {
    try {
      tanks = JSON.parse(data);
    } catch (e) {
      console.error('Error parsing stored tanks', e);
    }
  }

  // หากยังไม่มีข้อมูล หรือข้อมูลเป็นอาเรย์ว่างเปล่า ให้โหลดจาก INITIAL_TANKS ทันที
  if (!tanks || tanks.length === 0) {
    tanks = typeof INITIAL_TANKS !== 'undefined' ? [...INITIAL_TANKS] : [];
    if (tanks.length > 0) {
      saveAllTanks(tanks);
    }
  }

  // บังคับใช้กฎ 30 วัน: หากตรวจเกิน 30 วันแล้ว ให้เปลี่ยนเป็น 'ยังไม่เช็ค'
  let changed = false;
  tanks = tanks.map(t => {
    if (t.Tankcheck === 'เช็คแล้ว') {
      const days = getDaysSinceCheck(t.Lastcheck);
      if (days !== null && days >= 30) {
        t.Tankcheck = 'ยังไม่เช็ค';
        t.IsExpired30Days = true;
        t.DaysSinceCheck = days;
        changed = true;
      }
    }
    return t;
  });

  tanks.sort((a, b) => (a.FireTank || '').localeCompare(b.FireTank || '', undefined, { numeric: true, sensitivity: 'base' }));

  if (changed) {
    saveAllTanks(tanks);
  }
  return tanks;
}

function saveAllTanks(tanks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tanks));
}

function getTankById(fireTankId) {
  const tanks = getAllTanks();
  const tank = tanks.find(t => String(t.FireTank).trim().toUpperCase() === String(fireTankId).trim().toUpperCase()) || null;
  return applyThirtyDaysRule(tank);
}

// ─── บันทึกผลการตรวจเช็คสภาพถัง ───
async function saveCheckResult(fireTankId, isReady, inspectorName, newPicDataUrl, newWeight, remark) {
  const isD1 = await checkD1Connection();
  if (isD1) {
    try {
      const res = await fetch('api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FireTank: fireTankId,
          isReady: isReady,
          inspector: inspectorName,
          newPic: newPicDataUrl,
          weight: newWeight,
          remark: remark || ''
        })
      });
      if (res.ok) {
        // อัปเดตแคชในเครื่องด้วย
        saveCheckResultLocal(fireTankId, isReady, inspectorName, newPicDataUrl, newWeight, remark);
        return true;
      }
    } catch (e) {
      console.warn('D1 check save failed, saving to local', e);
    }
  }
  return saveCheckResultLocal(fireTankId, isReady, inspectorName, newPicDataUrl, newWeight, remark);
}

function saveCheckResultLocal(fireTankId, isReady, inspectorName, newPicDataUrl, newWeight, remark) {
  const tanks = getAllTanks();
  const idx = tanks.findIndex(t => String(t.FireTank).trim().toUpperCase() === String(fireTankId).trim().toUpperCase());
  if (idx === -1) return false;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${year}-${month}-${day} ${hours}:${mins}`;

  tanks[idx].Lastcheck = timeStr;
  tanks[idx].Tankcheck = 'เช็คแล้ว';
  tanks[idx].ReadyorNot = isReady ? 'Ready' : 'Not Ready';
  tanks[idx].TankStatus = Boolean(isReady);
  tanks[idx].Inspector = inspectorName || '';
  tanks[idx].Remark = remark || '';

  if (newWeight !== null && newWeight !== undefined && newWeight !== '') {
    tanks[idx]['Weight (lb)'] = parseFloat(newWeight);
  }

  if (newPicDataUrl) {
    tanks[idx].PicTank = newPicDataUrl;
  }

  tanks[idx].Exptank = calculateExptank(tanks[idx].Inuse, timeStr);
  saveAllTanks(tanks);
  return true;
}

// ─── เพิ่มถังใหม่ ───
async function addTank(tankData) {
  const isD1 = await checkD1Connection();
  if (isD1) {
    try {
      const res = await fetch('api/tanks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tankData)
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.message || 'เกิดข้อผิดพลาดในการบันทึกลง SQL' };
      }
      addTankLocal(tankData);
      return { success: true };
    } catch (e) {
      console.warn('D1 add failed', e);
    }
  }
  return addTankLocal(tankData);
}

function addTankLocal(tankData) {
  const tanks = getAllTanks();
  const tankId = String(tankData.FireTank || '').trim().toUpperCase();
  if (tanks.some(t => String(t.FireTank).trim().toUpperCase() === tankId)) {
    return { success: false, message: `รหัสถัง "${tankId}" มีอยู่แล้วในระบบ` };
  }

  const inuseFormatted = formatInuseDate(tankData.Inuse);
  const exptank = calculateExptank(inuseFormatted, tankData.Lastcheck);

  const newTank = {
    FireTank: tankId,
    Types: tankData.Types || '',
    'Weight (lb)': tankData['Weight (lb)'] ? parseFloat(tankData['Weight (lb)']) : null,
    Area: tankData.Area || '',
    Inuse: inuseFormatted,
    Lastcheck: tankData.Lastcheck || '',
    Tankcheck: tankData.Tankcheck || 'ยังไม่เช็ค',
    ReadyorNot: tankData.ReadyorNot || 'Not Ready',
    TankStatus: tankData.ReadyorNot === 'Ready',
    Exptank: exptank,
    PicTank: tankData.PicTank || null,
    PicArea: tankData.PicArea || null,
    Inspector: tankData.Inspector || '',
    Responsible: tankData.Responsible || ''
  };

  tanks.push(newTank);
  saveAllTanks(tanks);
  return { success: true };
}

// ─── แก้ไขถังเดิม ───
async function updateTank(tankId, tankData) {
  const isD1 = await checkD1Connection();
  if (isD1) {
    try {
      const res = await fetch('api/tanks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tankData, FireTank: tankId })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.message || 'เกิดข้อผิดพลาดในการอัปเดต SQL' };
      }
      updateTankLocal(tankId, tankData);
      return { success: true };
    } catch (e) {
      console.warn('D1 update failed', e);
    }
  }
  return updateTankLocal(tankId, tankData);
}

function updateTankLocal(tankId, tankData) {
  const tanks = getAllTanks();
  const idx = tanks.findIndex(t => String(t.FireTank).trim().toUpperCase() === String(tankId).trim().toUpperCase());
  if (idx === -1) return { success: false, message: 'ไม่พบถังดับเพลิง' };

  const inuseFormatted = formatInuseDate(tankData.Inuse);
  const exptank = calculateExptank(inuseFormatted, tankData.Lastcheck);

  tanks[idx].Types = tankData.Types || '';
  tanks[idx]['Weight (lb)'] = tankData['Weight (lb)'] ? parseFloat(tankData['Weight (lb)']) : null;
  tanks[idx].Area = tankData.Area || '';
  tanks[idx].Inuse = inuseFormatted;
  tanks[idx].Lastcheck = tankData.Lastcheck || '';
  tanks[idx].Tankcheck = tankData.Tankcheck || 'ยังไม่เช็ค';
  tanks[idx].ReadyorNot = tankData.ReadyorNot || (tanks[idx].Tankcheck === 'เช็คแล้ว' ? 'Ready' : 'Not Ready');
  tanks[idx].TankStatus = tanks[idx].ReadyorNot === 'Ready';
  tanks[idx].Exptank = exptank;
  tanks[idx].Inspector = tankData.Inspector || '';
  tanks[idx].Responsible = tankData.Responsible !== undefined ? tankData.Responsible : (tanks[idx].Responsible || '');

  if (tankData.PicTank) tanks[idx].PicTank = tankData.PicTank;
  if (tankData.PicArea) tanks[idx].PicArea = tankData.PicArea;

  saveAllTanks(tanks);
  return { success: true };
}

// ─── ลบถัง ───
async function deleteTank(tankId) {
  const isD1 = await checkD1Connection();
  if (isD1) {
    try {
      const res = await fetch(`api/tanks?id=${encodeURIComponent(tankId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'ลบไม่สำเร็จ');
        return false;
      }
    } catch (e) {
      console.warn('D1 delete failed', e);
    }
  }
  return deleteTankLocal(tankId);
}

function deleteTankLocal(tankId) {
  let tanks = getAllTanks();
  const initialLen = tanks.length;
  tanks = tanks.filter(t => String(t.FireTank).trim().toUpperCase() !== String(tankId).trim().toUpperCase());
  if (tanks.length === initialLen) return false;
  saveAllTanks(tanks);
  return true;
}

// คืนค่าเริ่มต้น (เฉพาะ Admin P2)
function resetDatabase() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user || user.PermitDo < 2) {
    alert('⚠️ เฉพาะผู้ดูแลระบบ (Admin P2) เท่านั้นที่สามารถคืนค่าฐานข้อมูลได้');
    return;
  }
  if (confirm('⚠️ ต้องการคืนค่าฐานข้อมูลเป็นค่าเริ่มต้นทั้งหมดหรือไม่?\nข้อมูลการตรวจและรูปภาพที่บันทึกไว้จะถูกรีเซ็ต')) {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }
}

// ─── Export to Excel (.xlsx) (เฉพาะ Admin P2) ───
async function exportToExcel() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user || user.PermitDo < 2) {
    alert('⚠️ คุณไม่มีสิทธิ์ส่งออกข้อมูล Excel (อนุญาตเฉพาะระดับ Admin P2 เท่านั้น)');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('กำลังโหลดไลบรารี Excel กรุณาลองใหม่อีกครั้ง');
    return;
  }

  const tanks = await fetchAllTanks();
  const excelRows = tanks.map(t => ({
    'FireTank': t.FireTank,
    'Types': t.Types,
    'Weight (lb)': t['Weight (lb)'],
    'Area': t.Area,
    'Inuse': t.Inuse,
    'Lastcheck': t.Lastcheck,
    'Tankcheck': t.Tankcheck,
    'ReadyorNot': t.ReadyorNot,
    'TankStatus': t.TankStatus,
    'Exptank': t.Exptank,
    'PicTank': t.PicTank && t.PicTank.startsWith('data:') ? '[รูปถ่ายใหม่]' : t.PicTank,
    'PicArea': t.PicArea && t.PicArea.startsWith('data:') ? '[รูปถ่ายใหม่]' : t.PicArea,
    'Inspector': t.Inspector || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows);
  XLSX.utils.book_append_sheet(wb, ws, 'FirePump');

  const users = getUsers();
  const wsUsers = XLSX.utils.json_to_sheet(users);
  XLSX.utils.book_append_sheet(wb, wsUsers, 'Johpor');

  const now = new Date();
  const filename = `FirePump_Export_${now.toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── Import from Excel (.xlsx) (เฉพาะ Admin P2) ───
function importFromExcel(file, callback) {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user || user.PermitDo < 2) {
    alert('⚠️ เฉพาะผู้ดูแลระบบ (Admin P2) เท่านั้นที่สามารถนำเข้าไฟล์ Excel ได้');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('ไลบรารี Excel ยังไม่พร้อม');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (json && json.length > 0) {
        const importedTanks = json.map(r => ({
          FireTank: r.FireTank || r['FireTank'] || '',
          Types: r.Types || '',
          'Weight (lb)': r['Weight (lb)'] || r.Weight || null,
          Area: r.Area || '',
          Inuse: formatInuseDate(r.Inuse),
          Lastcheck: r.Lastcheck ? String(r.Lastcheck) : '',
          Tankcheck: r.Tankcheck || 'ยังไม่เช็ค',
          ReadyorNot: r.ReadyorNot || 'Not Ready',
          TankStatus: r.TankStatus === true || r.ReadyorNot === 'Ready',
          Exptank: r.Exptank || calculateExptank(r.Inuse, r.Lastcheck),
          PicTank: r.PicTank || null,
          PicArea: r.PicArea || null,
          Inspector: r.Inspector || ''
        })).filter(t => t.FireTank);

        saveAllTanks(importedTanks);

        // ถ้าเชื่อมต่อ D1 อยู่ ให้ sync ขึ้น SQL ด้วย
        const isD1 = await checkD1Connection();
        if (isD1) {
          for (const t of importedTanks) {
            try {
              await fetch('api/tanks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(t)
              });
            } catch (err) {}
          }
        }

        if (callback) callback({ success: true, count: importedTanks.length });
      } else {
        if (callback) callback({ success: false, message: 'ไม่พบข้อมูลในไฟล์ Excel' });
      }
    } catch (err) {
      console.error(err);
      if (callback) callback({ success: false, message: 'รูปแบบไฟล์ไม่ถูกต้อง: ' + err.message });
    }
  };
  reader.readAsArrayBuffer(file);
}
