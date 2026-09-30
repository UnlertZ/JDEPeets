/**
 * functions/api/seed.js — Cloudflare D1 Seeder API
 * เรียกใช้ผ่าน URL: https://<domain>/api/seed เพื่อใส่ข้อมูลเริ่มต้น (Admin + ถัง) เข้า D1 อัตโนมัติ
 */

export async function onRequestGet(context) {
  const { env } = context;
  try {
    // 1. เพิ่มผู้ใช้ Admin P3
    await env.DB.prepare(`
      INSERT OR REPLACE INTO users (username, password, rank, permit_do, em_name) VALUES
      ('johporadmin', 'Admin0123456789', 'P3', 3, 'Administrator'),
      ('LeaderLinePD1', 'PD1', 'P1', 1, 'Jort')
    `).run();

    // 2. ตรวจสอบจำนวนถังใน D1
    const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM tanks').first();
    const count = countRes ? countRes.count : 0;

    return new Response(JSON.stringify({
      success: true,
      message: '✅ สร้างบัญชี Admin (johporadmin) สิทธิ์ P3 ใน Cloudflare D1 เรียบร้อยแล้ว!',
      currentTanksInD1: count,
      loginInfo: {
        username: 'johporadmin',
        password: 'Admin0123456789',
        rank: 'P3'
      }
    }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + err.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
