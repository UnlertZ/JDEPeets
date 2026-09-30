/**
 * functions/api/tanks.js — Cloudflare D1 API สำหรับจัดการข้อมูลถังดับเพลิง
 */

function getDaysSinceCheck(lastcheckVal) {
  if (!lastcheckVal) return null;
  const s = String(lastcheckVal).trim();
  if (!s) return null;

  let checkDate = null;
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
  } else if (/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.test(s)) {
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

  if (!checkDate || isNaN(checkDate.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - checkDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatTankResponse(row) {
  let tankCheck = row.tankcheck || 'ยังไม่เช็ค';
  // กฎ 30 วัน: หากตรวจเกิน 30 วันแล้ว ให้เปลี่ยนเป็นยังไม่เช็ค
  if (tankCheck === 'เช็คแล้ว') {
    const days = getDaysSinceCheck(row.lastcheck);
    if (days !== null && days >= 30) {
      tankCheck = 'ยังไม่เช็ค';
    }
  }

  return {
    FireTank: row.fire_tank,
    Types: row.types,
    'Weight (lb)': row.weight,
    Area: row.area,
    Inuse: row.inuse,
    Lastcheck: row.lastcheck,
    Tankcheck: tankCheck,
    ReadyorNot: row.ready_or_not,
    TankStatus: Boolean(row.tank_status),
    Exptank: row.exptank,
    PicTank: row.pic_tank,
    PicArea: row.pic_area,
    Inspector: row.inspector,
    Responsible: row.responsible,
    Remark: row.remark || ''
  };
}

// GET: ดึงรายการถังทั้งหมด
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM tanks ORDER BY fire_tank ASC'
    ).all();

    const formatted = results.map(formatTankResponse);
    formatted.sort((a, b) => (a.FireTank || '').localeCompare(b.FireTank || '', undefined, { numeric: true, sensitivity: 'base' }));

    return new Response(JSON.stringify(formatted), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// POST: เพิ่มถังใหม่
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const tankId = String(body.FireTank || '').trim().toUpperCase();
    if (!tankId) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });
    }

    // ตรวจสอบรหัสซ้ำ
    const existing = await env.DB.prepare('SELECT fire_tank FROM tanks WHERE fire_tank = ?').bind(tankId).first();
    if (existing) {
      return new Response(JSON.stringify({ success: false, message: `รหัสถัง "${tankId}" มีอยู่แล้วในระบบ` }), { status: 400 });
    }

    const weightVal = body['Weight (lb)'] ? parseFloat(body['Weight (lb)']) : null;
    const isReady = body.ReadyorNot === 'Ready';

    await env.DB.prepare(`
      INSERT INTO tanks (fire_tank, types, weight, area, inuse, lastcheck, tankcheck, ready_or_not, tank_status, exptank, pic_tank, pic_area, inspector, responsible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tankId,
      body.Types || '',
      weightVal,
      body.Area || '',
      body.Inuse || '',
      body.Lastcheck || '',
      body.Tankcheck || 'ยังไม่เช็ค',
      body.ReadyorNot || 'Not Ready',
      isReady ? 1 : 0,
      body.Exptank || '',
      body.PicTank || null,
      body.PicArea || null,
      body.Inspector || '',
      body.Responsible || ''
    ).run();

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}

// PUT: แก้ไขข้อมูลถัง
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const tankId = String(body.FireTank || '').trim().toUpperCase();
    if (!tankId) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });
    }

    const weightVal = body['Weight (lb)'] ? parseFloat(body['Weight (lb)']) : null;
    const isReady = body.ReadyorNot === 'Ready';

    await env.DB.prepare(`
      UPDATE tanks
      SET types = ?, weight = ?, area = ?, inuse = ?, lastcheck = ?,
          tankcheck = ?, ready_or_not = ?, tank_status = ?, exptank = ?,
          pic_tank = COALESCE(?, pic_tank), pic_area = COALESCE(?, pic_area),
          inspector = ?, responsible = ?
      WHERE fire_tank = ?
    `).bind(
      body.Types || '',
      weightVal,
      body.Area || '',
      body.Inuse || '',
      body.Lastcheck || '',
      body.Tankcheck || 'ยังไม่เช็ค',
      body.ReadyorNot || 'Not Ready',
      isReady ? 1 : 0,
      body.Exptank || '',
      body.PicTank || null,
      body.PicArea || null,
      body.Inspector || '',
      body.Responsible || '',
      tankId
    ).run();

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}

// DELETE: ลบถัง
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const tankId = url.searchParams.get('id');
    if (!tankId) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });
    }

    await env.DB.prepare('DELETE FROM tanks WHERE fire_tank = ?').bind(tankId.toUpperCase()).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}
