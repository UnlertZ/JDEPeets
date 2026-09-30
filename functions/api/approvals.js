/**
 * functions/api/approvals.js — Cloudflare D1 Approvals API
 * รองรับ: GET (ดึง pending+users), POST (อนุมัติ), PUT (ปรับ permit), DELETE (ปฏิเสธ pending / ลบ user จริง)
 */

// GET: ดึงรายการ pending_users และ users ทั้งหมด
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const pendingQuery = await env.DB.prepare('SELECT username as Username, em_name as EmName, rank as Rank, permit_do as PermitDo, registered_at as RegisteredAt FROM pending_users').all();
    const usersQuery = await env.DB.prepare('SELECT username as Username, em_name as EmName, rank as Rank, permit_do as PermitDo FROM users').all();

    return new Response(JSON.stringify({
      pending: pendingQuery.results || [],
      users: usersQuery.results || []
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// POST: อนุมัติสมาชิก (pending → users ด้วยสิทธิ์ P1)
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username } = await request.json();
    const uTrim = String(username || '').trim();

    const pending = await env.DB.prepare('SELECT * FROM pending_users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).first();
    if (!pending) {
      return new Response(JSON.stringify({ success: false, message: 'ไม่พบรายการผู้สมัครนี้' }), { status: 404 });
    }

    // ลบออกจาก pending_users
    await env.DB.prepare('DELETE FROM pending_users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).run();

    // บันทึกเข้า users ด้วย P1
    await env.DB.prepare(`
      INSERT OR REPLACE INTO users (username, password, rank, permit_do, em_name)
      VALUES (?, ?, 'P1', 1, ?)
    `).bind(pending.username, pending.password, pending.em_name).run();

    return new Response(JSON.stringify({ success: true, user: { Username: pending.username, EmName: pending.em_name } }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}

// PUT: ปรับระดับสิทธิ์ของ user ที่มีอยู่ (P2 ปรับได้เฉพาะ P1, P3 ปรับได้ทุกระดับ)
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const targetUsername = String(body.username || '').trim();
    const newPermit = parseInt(body.permitDo, 10);
    const requestorPermit = parseInt(body.requestorPermitDo, 10);

    if (!targetUsername || isNaN(newPermit)) {
      return new Response(JSON.stringify({ success: false, message: 'ข้อมูลไม่ครบถ้วน' }), { status: 400 });
    }

    // ดึงข้อมูล target user ปัจจุบัน
    const targetUser = await env.DB.prepare('SELECT permit_do FROM users WHERE LOWER(username) = ?').bind(targetUsername.toLowerCase()).first();
    if (!targetUser) {
      return new Response(JSON.stringify({ success: false, message: 'ไม่พบผู้ใช้ในระบบ' }), { status: 404 });
    }

    // P2 (permit=2) ห้ามแตะ user ที่เป็น P3 (permit=3)
    if (requestorPermit < 3 && targetUser.permit_do >= 3) {
      return new Response(JSON.stringify({ success: false, message: 'ไม่มีสิทธิ์ปรับระดับผู้ใช้ที่เป็น P3 (Super Admin)' }), { status: 403 });
    }

    // กำหนด rank ตาม permitDo
    const newRank = newPermit >= 3 ? 'P3' : newPermit >= 2 ? 'P2' : 'P1';

    await env.DB.prepare('UPDATE users SET permit_do = ?, rank = ? WHERE LOWER(username) = ?')
      .bind(newPermit, newRank, targetUsername.toLowerCase()).run();

    return new Response(JSON.stringify({ success: true, newPermit, newRank }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}

// DELETE: ปฏิเสธ pending user หรือลบ active user ออกจากระบบ
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get('username');
    const type = url.searchParams.get('type') || 'pending'; // 'pending' หรือ 'user'
    const requestorPermit = parseInt(url.searchParams.get('requestorPermit') || '0', 10);

    if (!username) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุชื่อผู้ใช้' }), { status: 400 });
    }

    if (type === 'user') {
      // ลบ active user — ตรวจสอบสิทธิ์ก่อน
      const targetUser = await env.DB.prepare('SELECT permit_do FROM users WHERE LOWER(username) = ?').bind(username.trim().toLowerCase()).first();
      if (!targetUser) {
        return new Response(JSON.stringify({ success: false, message: 'ไม่พบผู้ใช้' }), { status: 404 });
      }
      // P2 ห้ามลบ P3
      if (requestorPermit < 3 && targetUser.permit_do >= 3) {
        return new Response(JSON.stringify({ success: false, message: 'ไม่มีสิทธิ์ลบผู้ใช้ที่เป็น P3 (Super Admin)' }), { status: 403 });
      }
      await env.DB.prepare('DELETE FROM users WHERE LOWER(username) = ?').bind(username.trim().toLowerCase()).run();
    } else {
      // ลบ pending user
      await env.DB.prepare('DELETE FROM pending_users WHERE LOWER(username) = ?').bind(username.trim().toLowerCase()).run();
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}
