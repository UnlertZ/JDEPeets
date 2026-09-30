/**
 * functions/api/auth.js — Cloudflare D1 Authentication API
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username, password } = await request.json();
    const uTrim = String(username || '').trim().toLowerCase();
    const pTrim = String(password || '').trim();

    // 1. ตรวจสอบใน pending_users ก่อน
    const pending = await env.DB.prepare(
      'SELECT username FROM pending_users WHERE LOWER(username) = ?'
    ).bind(uTrim).first();

    if (pending) {
      return new Response(JSON.stringify({
        success: false,
        message: '⚠️ บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบ (Admin) อนุมัติ กรุณารอการตรวจสอบ'
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // 2. ตรวจสอบใน users
    let user = await env.DB.prepare(
      'SELECT username, password, rank, permit_do, em_name FROM users WHERE LOWER(username) = ?'
    ).bind(uTrim).first();

    // Auto-create johporadmin เป็น P3 หากเป็นฐานข้อมูลใหม่ที่ยังไม่มีผู้ใช้
    if (!user && uTrim === 'johporadmin' && pTrim === 'Admin0123456789') {
      try {
        await env.DB.prepare(
          'INSERT OR REPLACE INTO users (username, password, rank, permit_do, em_name) VALUES (?, ?, ?, ?, ?)'
        ).bind('johporadmin', 'Admin0123456789', 'P3', 3, 'Administrator').run();
        user = {
          username: 'johporadmin',
          password: 'Admin0123456789',
          rank: 'P3',
          permit_do: 3,
          em_name: 'Administrator'
        };
      } catch (insertErr) {}
    }

    if (user && user.password === pTrim) {
      return new Response(JSON.stringify({
        success: true,
        user: {
          Username: user.username,
          Rank: user.rank,
          PermitDo: user.permit_do,
          EmName: user.em_name
        }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false,
      message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
