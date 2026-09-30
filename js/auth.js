/**
 * auth.js — ระบบยืนยันตัวตน, จัดการสิทธิ์ และระบบลงทะเบียนรออนุมัติ (Dual-Mode: Cloudflare D1 + LocalStorage)
 */

const AUTH_KEY = 'firetank_current_user';
const USERS_KEY = 'firetank_users';
const PENDING_USERS_KEY = 'firetank_pending_users';

function getUsers() {
  const customUsers = localStorage.getItem(USERS_KEY);
  if (customUsers) {
    try {
      const parsed = JSON.parse(customUsers);
      // Auto-update johporadmin เป็น P3 ในแคช
      let changed = false;
      parsed.forEach(u => {
        if (u.Username.toLowerCase() === 'johporadmin' && u.PermitDo < 3) {
          u.PermitDo = 3;
          u.Rank = 'P3';
          changed = true;
        }
      });
      if (changed) saveUsers(parsed);
      return parsed;
    } catch (e) {
      console.error('Error parsing custom users', e);
    }
  }
  const initial = typeof INITIAL_USERS !== 'undefined' ? [...INITIAL_USERS] : [];
  localStorage.setItem(USERS_KEY, JSON.stringify(initial));
  return initial;
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getPendingUsers() {
  const pending = localStorage.getItem(PENDING_USERS_KEY);
  if (pending) {
    try {
      return JSON.parse(pending);
    } catch (e) {
      console.error('Error parsing pending users', e);
    }
  }
  return [];
}

function savePendingUsers(list) {
  localStorage.setItem(PENDING_USERS_KEY, JSON.stringify(list));
}

function getCurrentUser() {
  const u = localStorage.getItem(AUTH_KEY);
  if (!u) return null;
  try {
    const parsed = JSON.parse(u);
    if (parsed.Username && parsed.Username.toLowerCase() === 'johporadmin' && parsed.PermitDo < 3) {
      parsed.PermitDo = 3;
      parsed.Rank = 'P3';
      localStorage.setItem(AUTH_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─── ลงทะเบียน (Async รองรับ Cloudflare D1) ───
async function registerUser(username, password, emName) {
  const uTrim = username.trim();
  const pTrim = password.trim();
  const nameTrim = emName.trim();

  if (!uTrim || !pTrim || !nameTrim) {
    return { success: false, message: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' };
  }

  // ลองส่งไปยัง Cloudflare D1 API ก่อน
  try {
    const res = await fetch('api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uTrim, password: pTrim, emName: nameTrim })
    });
    if (res.ok) {
      return { success: true };
    } else {
      const data = await res.json();
      if (data && data.message) return { success: false, message: data.message };
    }
  } catch (e) {
    // API not reachable, fallback to LocalStorage
  }

  return registerUserLocal(uTrim, pTrim, nameTrim);
}

function registerUserLocal(uTrim, pTrim, nameTrim) {
  const existingUsers = getUsers();
  if (existingUsers.some(u => u.Username.toLowerCase() === uTrim.toLowerCase())) {
    return { success: false, message: `ชื่อผู้ใช้ "${uTrim}" มีอยู่ในระบบแล้ว` };
  }

  const pendingList = getPendingUsers();
  if (pendingList.some(u => u.Username.toLowerCase() === uTrim.toLowerCase())) {
    return { success: false, message: `ชื่อผู้ใช้ "${uTrim}" อยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบแล้ว` };
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const newPending = {
    Username: uTrim,
    Password: pTrim,
    EmName: nameTrim,
    Rank: 'P1',
    PermitDo: 1,
    RegisteredAt: dateStr
  };

  pendingList.push(newPending);
  savePendingUsers(pendingList);
  return { success: true };
}

// ─── อนุมัติสมาชิก (Async รองรับ Cloudflare D1) ───
async function approveUser(username) {
  try {
    const res = await fetch('api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (res.ok) {
      const data = await res.json();
      approveUserLocal(username);
      return { success: true, user: data.user || { Username: username, EmName: username } };
    }
  } catch (e) {}

  return approveUserLocal(username);
}

function approveUserLocal(username) {
  let pendingList = getPendingUsers();
  const target = pendingList.find(u => u.Username.toLowerCase() === username.trim().toLowerCase());
  if (!target) return { success: false, message: 'ไม่พบรายการผู้สมัครนี้' };

  pendingList = pendingList.filter(u => u.Username.toLowerCase() !== username.trim().toLowerCase());
  savePendingUsers(pendingList);

  const users = getUsers();
  users.push({
    Username: target.Username,
    Password: target.Password,
    Rank: 'P1',
    PermitDo: 1,
    EmName: target.EmName
  });
  saveUsers(users);

  return { success: true, user: target };
}

// ─── ปฏิเสธสมาชิก ───
async function rejectUser(username) {
  try {
    const res = await fetch(`api/approvals?username=${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      rejectUserLocal(username);
      return { success: true };
    }
  } catch (e) {}

  return rejectUserLocal(username);
}

function rejectUserLocal(username) {
  let pendingList = getPendingUsers();
  const initialLen = pendingList.length;
  pendingList = pendingList.filter(u => u.Username.toLowerCase() !== username.trim().toLowerCase());
  if (pendingList.length === initialLen) return { success: false, message: 'ไม่พบรายการผู้สมัคร' };
  savePendingUsers(pendingList);
  return { success: true };
}

// ─── ปรับระดับสิทธิ์ผู้ใช้ที่มีอยู่ (Async รองรับ Cloudflare D1) ───
async function updateUserPermit(targetUsername, newPermit) {
  const currentUser = getCurrentUser();
  if (!currentUser) return { success: false, message: 'กรุณาเข้าสู่ระบบก่อน' };
  if (currentUser.PermitDo < 2) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const res = await fetch('api/approvals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: targetUsername,
        permitDo: newPermit,
        requestorPermitDo: currentUser.PermitDo
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      updateUserPermitLocal(targetUsername, newPermit, data.newRank);
      return { success: true, newPermit: data.newPermit, newRank: data.newRank };
    }
    return { success: false, message: data.message || 'เกิดข้อผิดพลาด' };
  } catch (e) {}

  return updateUserPermitLocal(targetUsername, newPermit);
}

function updateUserPermitLocal(targetUsername, newPermit, newRank) {
  const currentUser = getCurrentUser();
  const users = getUsers();
  const idx = users.findIndex(u => u.Username.toLowerCase() === targetUsername.trim().toLowerCase());
  if (idx === -1) return { success: false, message: 'ไม่พบผู้ใช้' };

  // P2 ห้ามแตะ P3
  if (currentUser && currentUser.PermitDo < 3 && users[idx].PermitDo >= 3) {
    return { success: false, message: 'ไม่มีสิทธิ์ปรับระดับผู้ใช้ที่เป็น P3 (Super Admin)' };
  }

  const rank = newRank || (newPermit >= 3 ? 'P3' : newPermit >= 2 ? 'P2' : 'P1');
  users[idx].PermitDo = newPermit;
  users[idx].Rank = rank;
  saveUsers(users);
  return { success: true, newPermit, newRank: rank };
}

// ─── ลบ Active User ออกจากระบบ ───
async function deleteActiveUser(targetUsername) {
  const currentUser = getCurrentUser();
  if (!currentUser) return { success: false, message: 'กรุณาเข้าสู่ระบบก่อน' };
  if (currentUser.PermitDo < 2) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const res = await fetch(`api/approvals?username=${encodeURIComponent(targetUsername)}&type=user&requestorPermit=${currentUser.PermitDo}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      deleteActiveUserLocal(targetUsername);
      return { success: true };
    }
    return { success: false, message: data.message || 'เกิดข้อผิดพลาด' };
  } catch (e) {}

  return deleteActiveUserLocal(targetUsername);
}

function deleteActiveUserLocal(targetUsername) {
  const currentUser = getCurrentUser();
  const users = getUsers();
  const target = users.find(u => u.Username.toLowerCase() === targetUsername.trim().toLowerCase());
  if (!target) return { success: false, message: 'ไม่พบผู้ใช้' };

  // P2 ห้ามลบ P3
  if (currentUser && currentUser.PermitDo < 3 && target.PermitDo >= 3) {
    return { success: false, message: 'ไม่มีสิทธิ์ลบผู้ใช้ที่เป็น P3 (Super Admin)' };
  }

  const filtered = users.filter(u => u.Username.toLowerCase() !== targetUsername.trim().toLowerCase());
  saveUsers(filtered);
  return { success: true };
}


// ─── เข้าสู่ระบบ (Async รองรับ Cloudflare D1 + LocalStorage Fallback) ───
async function login(username, password) {
  const uTrim = username.trim().toLowerCase();
  const pTrim = password.trim();

  // ลองผ่าน API ก่อน
  try {
    const res = await fetch('api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uTrim, password: pTrim })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(data.user));
      return { success: true, user: data.user };
    }
  } catch (e) {
    // API not reachable, fallback to LocalStorage
  }

  // LocalStorage Fallback
  const pendingList = getPendingUsers();
  const inPending = pendingList.find(u => u.Username.toLowerCase() === uTrim);
  if (inPending) {
    return {
      success: false,
      message: '⚠️ บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบ (Admin) อนุมัติ กรุณารอการตรวจสอบก่อนเข้าสู่ระบบ'
    };
  }

  const users = getUsers();
  const found = users.find(u => u.Username.toLowerCase() === uTrim && u.Password === pTrim);
  if (found) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(found));
    return { success: true, user: found };
  }
  return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = 'index.html';
}

function requireAuth(minPermit = 1) {
  const user = getCurrentUser();
  if (!user) {
    sessionStorage.setItem('flash_msg', JSON.stringify({ type: 'warning', text: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' }));
    window.location.href = 'login.html';
    return false;
  }
  if (user.PermitDo < minPermit) {
    sessionStorage.setItem('flash_msg', JSON.stringify({ type: 'danger', text: 'คุณไม่มีสิทธิ์ในการเข้าถึงหน้านี้ (เฉพาะระดับ Admin เท่านั้น)' }));
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

async function renderNavbarAuth() {
  const user = getCurrentUser();
  const authNav = document.getElementById('navbarAuthArea');
  if (!authNav) return;

  if (user) {
    const isAdmin = user.PermitDo >= 2; // P2 หรือ P3
    const isP3   = user.PermitDo >= 3;
    let pendingCount = getPendingUsers().length;

    // ดึงจำนวนรออนุมัติจริงจาก D1 สำหรับ P2+
    if (isAdmin) {
      try {
        const res = await fetch('api/approvals');
        if (res.ok) {
          const data = await res.json();
          if (data && data.pending) pendingCount = data.pending.length;
        }
      } catch (e) {}
    }

    let adminBadgeHtml = '';
    if (isAdmin) {
      adminBadgeHtml = `
        <a href="approvals.html" class="btn btn-outline-warning btn-sm fw-semibold position-relative me-2" title="อนุมัติสมาชิกใหม่">
          <i class="bi bi-person-check-fill me-1"></i>อนุมัติสมาชิก
          ${pendingCount > 0 ? `<span class="badge bg-danger rounded-pill ms-1">${pendingCount}</span>` : ''}
        </a>
      `;
    }

    // สีตาม rank: P3=ม่วง, P2=แดง, P1=เหลือง
    const rankBadgeClass = isP3 ? 'bg-purple text-white' : isAdmin ? 'bg-danger' : 'bg-warning text-dark';
    const rankStyle = isP3 ? 'style="background:#6f42c1;"' : '';

    authNav.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        ${adminBadgeHtml}
        <span class="navbar-text text-white small d-none d-md-inline">
          <i class="bi bi-person-circle me-1 text-warning"></i>
          <strong>${user.EmName || user.Username}</strong>
          <span class="badge ${rankBadgeClass} ms-1" ${rankStyle}>${user.Rank || 'P1'}</span>
        </span>
        <button onclick="logout()" class="btn btn-outline-light btn-sm">
          <i class="bi bi-box-arrow-right me-1"></i>ออกจากระบบ
        </button>
      </div>
    `;
  } else {
    authNav.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <a href="register.html" class="btn btn-outline-light btn-sm fw-semibold">
          <i class="bi bi-person-plus me-1"></i>ลงทะเบียน
        </a>
        <a href="login.html" class="btn btn-warning btn-sm fw-bold">
          <i class="bi bi-box-arrow-in-right me-1"></i>เข้าสู่ระบบ
        </a>
      </div>
    `;
  }
}

function checkFlashMessage() {
  const msg = sessionStorage.getItem('flash_msg');
  if (msg) {
    try {
      const data = JSON.parse(msg);
      const container = document.getElementById('flashAlertArea');
      if (container) {
        container.innerHTML = `
          <div class="alert alert-${data.type} alert-dismissible fade show shadow-sm" role="alert">
            ${data.text}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
          </div>
        `;
        setTimeout(() => {
          const alertEl = container.querySelector('.alert');
          if (alertEl) {
            const bsAlert = new bootstrap.Alert(alertEl);
            bsAlert.close();
          }
        }, 5000);
      }
    } catch (e) {}
    sessionStorage.removeItem('flash_msg');
  }
}

function initAuthUI() {
  renderNavbarAuth();
  checkFlashMessage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}
