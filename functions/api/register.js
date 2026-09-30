/**
 * functions/api/register.js — Cloudflare D1 Registration API
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username, password, emName } = await request.json();
    const uTrim = String(username || '').trim();
    const pTrim = String(password || '').trim();
    const nameTrim = String(emName || '').trim();

    if (!uTrim || !pTrim || !nameTrim) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' }), { status: 400 });
    }

    // ตรวจสอบใน users
    const existsUser = await env.DB.prepare('SELECT username FROM users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).first();
    if (existsUser) {
      return new Response(JSON.stringify({ success: false, message: `ชื่อผู้ใช้ "${uTrim}" มีอยู่ในระบบแล้ว` }), { status: 400 });
    }

    // ตรวจสอบใน pending_users
    const existsPending = await env.DB.prepare('SELECT username FROM pending_users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).first();
    if (existsPending) {
      return new Response(JSON.stringify({ success: false, message: `ชื่อผู้ใช้ "${uTrim}" อยู่ระหว่างรอการอนุมัติอยู่แล้ว` }), { status: 400 });
    }

    const now = new Date();
    const registeredAt = now.toLocaleString('th-TH');

    await env.DB.prepare(`
      INSERT INTO pending_users (username, password, em_name, rank, permit_do, registered_at)
      VALUES (?, ?, ?, 'P1', 1, ?)
    `).bind(uTrim, pTrim, nameTrim, registeredAt).run();

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500 });
  }
}
