/**
 * _worker.js — Universal Gateway สำหรับ Cloudflare Workers & Pages
 * Self-contained 100% ไม่มี import ภายนอก ป้องกันปัญหาโมดูล resolve ไม่เจอ
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // ─── API Routes ───
    try {
      // 1. /api/auth
      if (pathname === '/api/auth') {
        if (method === 'POST') {
          const { username, password } = await request.json();
          const uTrim = String(username || '').trim().toLowerCase();
          const pTrim = String(password || '').trim();

          const pending = await env.DB.prepare(
            'SELECT username FROM pending_users WHERE LOWER(username) = ?'
          ).bind(uTrim).first();

          if (pending) {
            return new Response(JSON.stringify({
              success: false,
              message: '⚠️ บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบ (Admin) อนุมัติ กรุณารอการตรวจสอบ'
            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
          }

          let user = await env.DB.prepare(
            'SELECT username, password, rank, permit_do, em_name FROM users WHERE LOWER(username) = ?'
          ).bind(uTrim).first();

          // Auto-seed johporadmin
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
            } catch (e) {}
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

          return new Response(JSON.stringify({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // 2. /api/check
      if (pathname === '/api/check') {
        if (method === 'POST') {
          const body = await request.json();
          const tankId = String(body.FireTank || '').trim().toUpperCase();
          if (!tankId) return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });

          const tank = await env.DB.prepare('SELECT inuse FROM tanks WHERE fire_tank = ?').bind(tankId).first();
          if (!tank) return new Response(JSON.stringify({ success: false, message: 'ไม่พบถังที่ระบุ' }), { status: 404 });

          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hours = String(now.getHours()).padStart(2, '0');
          const mins = String(now.getMinutes()).padStart(2, '0');
          const timeStr = `${year}-${month}-${day} ${hours}:${mins}`;

          let exptank = '';
          if (tank.inuse) {
            const match = String(tank.inuse).match(/\d{4}/);
            if (match) {
              const inuseYear = parseInt(match[0], 10);
              const diff = Math.max(0, year - inuseYear);
              exptank = `${diff}ปี`;
            }
          }

          const isReady = Boolean(body.isReady);
          const weightVal = body.weight ? parseFloat(body.weight) : null;
          const inspectorName = body.inspector || '';
          const newPic = body.newPic || null;
          const remark = body.remark || '';

          await env.DB.prepare(`
            UPDATE tanks
            SET lastcheck = ?, tankcheck = 'เช็คแล้ว', ready_or_not = ?, tank_status = ?,
                exptank = ?, inspector = ?, weight = COALESCE(?, weight),
                pic_tank = COALESCE(?, pic_tank), remark = ?
            WHERE fire_tank = ?
          `).bind(timeStr, isReady ? 'Ready' : 'Not Ready', isReady ? 1 : 0, exptank, inspectorName, weightVal, newPic, remark, tankId).run();

          return new Response(JSON.stringify({
            success: true,
            data: { lastcheck: timeStr, exptank: exptank, ready_or_not: isReady ? 'Ready' : 'Not Ready' }
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      }

      // 3. /api/register
      if (pathname === '/api/register') {
        if (method === 'POST') {
          const { username, password, emName } = await request.json();
          const uTrim = String(username || '').trim().toLowerCase();
          const pTrim = String(password || '').trim();
          const nameTrim = String(emName || '').trim();

          if (!uTrim || !pTrim || !nameTrim) return new Response(JSON.stringify({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' }), { status: 400 });

          const existingUser = await env.DB.prepare('SELECT username FROM users WHERE LOWER(username) = ?').bind(uTrim).first();
          if (existingUser) return new Response(JSON.stringify({ success: false, message: `ชื่อผู้ใช้ "${uTrim}" มีอยู่ในระบบแล้ว` }), { status: 409 });

          const existingPending = await env.DB.prepare('SELECT username FROM pending_users WHERE LOWER(username) = ?').bind(uTrim).first();
          if (existingPending) return new Response(JSON.stringify({ success: false, message: `ชื่อผู้ใช้ "${uTrim}" อยู่ระหว่างรอการอนุมัติแล้ว` }), { status: 409 });

          const now = new Date();
          const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

          await env.DB.prepare(`
            INSERT INTO pending_users (username, password, em_name, rank, permit_do, registered_at)
            VALUES (?, ?, ?, 'P1', 1, ?)
          `).bind(uTrim, pTrim, nameTrim, dateStr).run();

          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
      }

      // 4. /api/seed
      if (pathname === '/api/seed') {
        await env.DB.prepare(`
          INSERT OR REPLACE INTO users (username, password, rank, permit_do, em_name) VALUES
          ('johporadmin', 'Admin0123456789', 'P3', 3, 'Administrator'),
          ('LeaderLinePD1', 'PD1', 'P1', 1, 'Jort')
        `).run();
        const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM tanks').first();
        return new Response(JSON.stringify({ success: true, message: '✅ Seed สำเร็จ', tanksCount: countRes ? countRes.count : 0 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 5. /api/tanks
      if (pathname === '/api/tanks') {
        if (method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM tanks ORDER BY fire_tank ASC').all();
          const formatted = (results || []).map(formatTankResponse);
          formatted.sort((a, b) => (a.FireTank || '').localeCompare(b.FireTank || '', undefined, { numeric: true, sensitivity: 'base' }));
          return new Response(JSON.stringify(formatted), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'POST') {
          const body = await request.json();
          const tankId = String(body.FireTank || '').trim().toUpperCase();
          if (!tankId) return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });

          const existing = await env.DB.prepare('SELECT fire_tank FROM tanks WHERE fire_tank = ?').bind(tankId).first();
          if (existing) return new Response(JSON.stringify({ success: false, message: `รหัสถัง "${tankId}" มีอยู่แล้ว` }), { status: 400 });

          const weightVal = body['Weight (lb)'] ? parseFloat(body['Weight (lb)']) : null;
          const isReady = body.ReadyorNot === 'Ready';

          await env.DB.prepare(`
            INSERT INTO tanks (fire_tank, types, weight, area, inuse, lastcheck, tankcheck, ready_or_not, tank_status, exptank, pic_tank, pic_area, inspector, responsible, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(tankId, body.Types || '', weightVal, body.Area || '', body.Inuse || '', body.Lastcheck || '', body.Tankcheck || 'ยังไม่เช็ค', body.ReadyorNot || 'Not Ready', isReady ? 1 : 0, body.Exptank || '', body.PicTank || null, body.PicArea || null, body.Inspector || '', body.Responsible || '', body.Remark || '').run();

          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'PUT') {
          const body = await request.json();
          const tankId = String(body.FireTank || '').trim().toUpperCase();
          if (!tankId) return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });

          const weightVal = body['Weight (lb)'] ? parseFloat(body['Weight (lb)']) : null;
          const isReady = body.ReadyorNot === 'Ready';

          await env.DB.prepare(`
            UPDATE tanks
            SET types = ?, weight = ?, area = ?, inuse = ?, lastcheck = ?,
                tankcheck = ?, ready_or_not = ?, tank_status = ?, exptank = ?,
                pic_tank = COALESCE(?, pic_tank), pic_area = COALESCE(?, pic_area),
                inspector = ?, responsible = ?, remark = ?
            WHERE fire_tank = ?
          `).bind(body.Types || '', weightVal, body.Area || '', body.Inuse || '', body.Lastcheck || '', body.Tankcheck || 'ยังไม่เช็ค', body.ReadyorNot || 'Not Ready', isReady ? 1 : 0, body.Exptank || '', body.PicTank || null, body.PicArea || null, body.Inspector || '', body.Responsible || '', body.Remark || '', tankId).run();

          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'DELETE') {
          const tankId = url.searchParams.get('id');
          if (!tankId) return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุรหัสถัง' }), { status: 400 });
          await env.DB.prepare('DELETE FROM tanks WHERE fire_tank = ?').bind(tankId.toUpperCase()).run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
      }

      // 6. /api/approvals
      if (pathname === '/api/approvals') {
        if (method === 'GET') {
          const pendingQuery = await env.DB.prepare('SELECT username as Username, em_name as EmName, rank as Rank, permit_do as PermitDo, registered_at as RegisteredAt FROM pending_users').all();
          const usersQuery = await env.DB.prepare('SELECT username as Username, em_name as EmName, rank as Rank, permit_do as PermitDo FROM users').all();
          return new Response(JSON.stringify({ pending: pendingQuery.results || [], users: usersQuery.results || [] }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'POST') {
          const { username } = await request.json();
          const uTrim = String(username || '').trim();
          const pending = await env.DB.prepare('SELECT * FROM pending_users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).first();
          if (!pending) return new Response(JSON.stringify({ success: false, message: 'ไม่พบรายการผู้สมัคร' }), { status: 404 });

          await env.DB.prepare('DELETE FROM pending_users WHERE LOWER(username) = ?').bind(uTrim.toLowerCase()).run();
          await env.DB.prepare('INSERT OR REPLACE INTO users (username, password, rank, permit_do, em_name) VALUES (?, ?, "P1", 1, ?)').bind(pending.username, pending.password, pending.em_name).run();

          return new Response(JSON.stringify({ success: true, user: { Username: pending.username, EmName: pending.em_name } }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'PUT') {
          const body = await request.json();
          const targetUsername = String(body.username || '').trim();
          const newPermit = parseInt(body.permitDo, 10);
          const requestorPermit = parseInt(body.requestorPermitDo, 10);

          if (!targetUsername || isNaN(newPermit)) return new Response(JSON.stringify({ success: false, message: 'ข้อมูลไม่ครบถ้วน' }), { status: 400 });

          const targetUser = await env.DB.prepare('SELECT permit_do FROM users WHERE LOWER(username) = ?').bind(targetUsername.toLowerCase()).first();
          if (!targetUser) return new Response(JSON.stringify({ success: false, message: 'ไม่พบผู้ใช้ในระบบ' }), { status: 404 });

          if (requestorPermit < 3 && targetUser.permit_do >= 3) {
            return new Response(JSON.stringify({ success: false, message: 'ไม่มีสิทธิ์ปรับระดับผู้ใช้ที่เป็น P3' }), { status: 403 });
          }

          const newRank = newPermit >= 3 ? 'P3' : newPermit >= 2 ? 'P2' : 'P1';
          await env.DB.prepare('UPDATE users SET permit_do = ?, rank = ? WHERE LOWER(username) = ?').bind(newPermit, newRank, targetUsername.toLowerCase()).run();

          return new Response(JSON.stringify({ success: true, newPermit, newRank }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'DELETE') {
          const targetUsername = url.searchParams.get('username');
          const type = url.searchParams.get('type') || 'pending';
          const requestorPermit = parseInt(url.searchParams.get('requestorPermit') || '0', 10);

          if (!targetUsername) return new Response(JSON.stringify({ success: false, message: 'กรุณาระบุชื่อผู้ใช้' }), { status: 400 });

          if (type === 'user') {
            const targetUser = await env.DB.prepare('SELECT permit_do FROM users WHERE LOWER(username) = ?').bind(targetUsername.trim().toLowerCase()).first();
            if (!targetUser) return new Response(JSON.stringify({ success: false, message: 'ไม่พบผู้ใช้' }), { status: 404 });
            if (requestorPermit < 3 && targetUser.permit_do >= 3) {
              return new Response(JSON.stringify({ success: false, message: 'ไม่มีสิทธิ์ลบผู้ใช้ที่เป็น P3' }), { status: 403 });
            }
            await env.DB.prepare('DELETE FROM users WHERE LOWER(username) = ?').bind(targetUsername.trim().toLowerCase()).run();
          } else {
            await env.DB.prepare('DELETE FROM pending_users WHERE LOWER(username) = ?').bind(targetUsername.trim().toLowerCase()).run();
          }

          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch (apiErr) {
      return new Response(JSON.stringify({ success: false, error: apiErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // ─── Static Assets ───
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return await env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
