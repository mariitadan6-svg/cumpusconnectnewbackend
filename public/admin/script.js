// ===================== CampusConnect Admin Panel =====================
const API = ''; // same origin as backend
let TOKEN = localStorage.getItem('cc_admin_token') || null;
let CURRENT_VIEW = 'overview';
let USERS_CACHE = [];

// ---------- BOOT ----------
window.addEventListener('load', async () => {
  if (TOKEN) {
    // Verify existing token
    const ok = await verifyToken();
    if (ok) enterDashboard();
    else showLogin();
  } else {
    showLogin();
  }
});

async function verifyToken() {
  try {
    const r = await fetch(API + '/api/admin/verify', { headers: { Authorization: 'Bearer ' + TOKEN } });
    return r.ok;
  } catch { return false; }
}

// ---------- LOGIN ----------
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  setTimeout(() => document.getElementById('pwd').focus(), 300);
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginErr');
  err.classList.remove('show');
  const password = document.getElementById('pwd').value;
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const r = await fetch(API + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');
    TOKEN = data.token;
    localStorage.setItem('cc_admin_token', TOKEN);
    // Nice transition
    document.querySelector('.login-card').style.transition = 'all .5s';
    document.querySelector('.login-card').style.transform = 'translateY(-30px) scale(.9)';
    document.querySelector('.login-card').style.opacity = '0';
    setTimeout(() => {
      enterDashboard();
      toast('Welcome, Administrator', 'success');
    }, 500);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
    btn.classList.remove('loading');
    btn.disabled = false;
    document.getElementById('pwd').value = '';
  }
}

function doLogout() {
  TOKEN = null;
  localStorage.removeItem('cc_admin_token');
  location.reload();
}

// ---------- DASHBOARD ----------
function enterDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  refreshAll();
  wireSidebar();
  checkApiStatus();
}

function wireSidebar() {
  document.querySelectorAll('.sb-item[data-view]').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });
}

function switchView(view) {
  CURRENT_VIEW = view;
  document.querySelectorAll('.sb-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  const titles = {
    overview: ['Overview', 'Real-time platform metrics'],
    users: ['Users', 'Manage all registered users'],
    matches: ['Matches', 'All successful matches'],
    messages: ['Messages', 'Recent conversations across platform'],
    analytics: ['Analytics', 'Deep insights & breakdowns'],
    settings: ['Settings', 'System configuration']
  };
  const [title, sub] = titles[view] || [view, ''];
  document.getElementById('viewTitle').textContent = title;
  document.getElementById('viewSub').textContent = sub;
  refreshAll();
}

async function refreshAll() {
  if (!TOKEN) return;
  try {
    if (CURRENT_VIEW === 'overview' || CURRENT_VIEW === 'analytics') await loadStats();
    if (CURRENT_VIEW === 'users' || CURRENT_VIEW === 'overview') await loadUsers();
    if (CURRENT_VIEW === 'matches') await loadMatches();
    if (CURRENT_VIEW === 'messages') await loadMessages();
  } catch (e) {
    console.error(e);
    if (e.message && e.message.includes('401')) doLogout();
  }
}

async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (r.status === 401) { doLogout(); throw new Error('401 unauthorized'); }
  if (!r.ok) throw new Error('Request failed');
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error('Delete failed');
  return r.json();
}

// ---------- STATS / OVERVIEW ----------
async function loadStats() {
  const s = await api('/api/admin/stats');
  animateNumber('stat-users', s.totals.users);
  animateNumber('stat-matches', s.totals.matches);
  animateNumber('stat-messages', s.totals.messages);
  animateNumber('stat-likes', s.totals.likes);

  // Vibes
  const vibes = document.getElementById('vibes');
  const total = s.byVibe.dating + s.byVibe.friendship + s.byVibe.hookup || 1;
  const vibeColors = {
    dating: 'linear-gradient(90deg,#ff5c9d,#7c5cff)',
    friendship: 'linear-gradient(90deg,#00d4ff,#7c5cff)',
    hookup: 'linear-gradient(90deg,#ff5c9d,#ffb347)'
  };
  vibes.innerHTML = ['dating', 'friendship', 'hookup'].map(v => `
    <div class="vibe-row">
      <div class="vlabel">${v}</div>
      <div class="vbar"><div style="width:${(s.byVibe[v] / total * 100).toFixed(1)}%;background:${vibeColors[v]}"></div></div>
      <div class="vcount">${s.byVibe[v]}</div>
    </div>
  `).join('');

  // Top counties
  renderCountyBars('countyBars', s.topCounties.slice(0, 6));
  renderCountyBars('countyBarsFull', s.topCounties);

  // Recent users
  const recent = document.getElementById('recentUsers');
  if (!s.recentUsers.length) {
    recent.innerHTML = '<div class="empty-state"><i class="fa-regular fa-user"></i><p>No users yet</p></div>';
  } else {
    recent.innerHTML = s.recentUsers.map(u => `
      <div class="recent-item">
        <div class="avatar" style="background:${gradFor(u.id)}">${initials(u.name)}</div>
        <div class="ri-body">
          <strong>${escapeHtml(u.name)}</strong>
          <small>${escapeHtml(u.email)} · ${escapeHtml(u.county)}</small>
        </div>
        <span class="ri-vibe ${u.lookingFor}">${u.lookingFor}</span>
      </div>
    `).join('');
  }

  // Analytics gender donut
  const gd = document.getElementById('genderDonut');
  const gTotal = Object.values(s.byGender).reduce((a, b) => a + b, 0) || 1;
  gd.innerHTML = Object.entries(s.byGender).map(([k, v]) => `
    <div class="gd-row ${k}">
      <div class="gd-dot"></div>
      <div class="gd-label">${k}</div>
      <div class="vbar" style="flex:2;height:8px;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden">
        <div style="width:${(v / gTotal * 100).toFixed(1)}%;height:100%;background:currentColor;border-radius:6px"></div>
      </div>
      <div class="gd-count">${v}</div>
    </div>
  `).join('');

  // Vibe chart (bars)
  const vc = document.getElementById('vibeChart');
  const maxV = Math.max(s.byVibe.dating, s.byVibe.friendship, s.byVibe.hookup, 1);
  vc.innerHTML = ['dating', 'friendship', 'hookup'].map(v => `
    <div class="vc-bar ${v}" style="height:${(s.byVibe[v] / maxV * 180).toFixed(0)}px">
      <span>${s.byVibe[v]}</span>
      <small>${v}</small>
    </div>
  `).join('');
}

function renderCountyBars(elId, list) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-location-dot"></i><p>No data</p></div>'; return; }
  const max = list[0].count;
  el.innerHTML = list.map(r => `
    <div class="cb-row">
      <div class="cb-name">${escapeHtml(r.county)}</div>
      <div class="cb-bar"><div style="width:${(r.count / max * 100).toFixed(0)}%"></div></div>
      <div class="cb-num">${r.count}</div>
    </div>
  `).join('');
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  const start = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min((t - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(current + (target - current) * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- USERS ----------
async function loadUsers() {
  USERS_CACHE = await api('/api/admin/users');
  document.getElementById('usersCount').textContent = USERS_CACHE.length;
  renderUsers();
}
function renderUsers() {
  const q = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const filtered = USERS_CACHE.filter(u =>
    !q || (u.name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q) ||
    (u.county || '').toLowerCase().includes(q) ||
    (u.subcounty || '').toLowerCase().includes(q)
  );
  const body = document.getElementById('usersTable');
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fa-regular fa-user"></i><p>No users found</p></div></td></tr>';
    return;
  }
  body.innerHTML = filtered.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="avatar" style="background:${gradFor(u.id)}">${initials(u.name)}</div>
          <div><strong>${escapeHtml(u.name || '—')}</strong></div>
        </div>
      </td>
      <td>${escapeHtml(u.email || '')}</td>
      <td>${u.age || '—'}</td>
      <td style="text-transform:capitalize">${escapeHtml(u.gender || '—')}</td>
      <td><span class="ri-vibe ${u.lookingFor}">${escapeHtml(u.lookingFor || '')}</span></td>
      <td>${escapeHtml(u.subcounty || '')}, ${escapeHtml(u.county || '')}</td>
      <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
      <td><button class="btn-delete" onclick="deleteUser('${u.id}','${escapeAttr(u.name)}')"><i class="fa-solid fa-trash"></i></button></td>
    </tr>
  `).join('');
}
async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
  try {
    await apiDelete('/api/admin/users/' + id);
    toast(`User ${name} deleted`, 'success');
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- MATCHES ----------
async function loadMatches() {
  const list = await api('/api/admin/matches');
  document.getElementById('matchesCount').textContent = list.length;
  const body = document.getElementById('matchesTable');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="3"><div class="empty-state"><i class="fa-regular fa-heart"></i><p>No matches yet</p></div></td></tr>';
    return;
  }
  body.innerHTML = list.map(m => `
    <tr>
      <td><div class="user-cell"><div class="avatar" style="background:${gradFor(m.a?.id || 'x')}">${initials(m.a?.name || '?')}</div><strong>${escapeHtml(m.a?.name || 'Deleted')}</strong></div></td>
      <td><div class="user-cell"><div class="avatar" style="background:${gradFor(m.b?.id || 'x')}">${initials(m.b?.name || '?')}</div><strong>${escapeHtml(m.b?.name || 'Deleted')}</strong></div></td>
      <td>${new Date(m.ts).toLocaleString()}</td>
    </tr>
  `).join('');
}

// ---------- MESSAGES ----------
async function loadMessages() {
  const list = await api('/api/admin/messages');
  document.getElementById('msgsCount').textContent = list.length;
  const feed = document.getElementById('msgsFeed');
  if (!list.length) {
    feed.innerHTML = '<div class="empty-state"><i class="fa-regular fa-comments"></i><p>No messages yet</p></div>';
    return;
  }
  feed.innerHTML = list.map(m => `
    <div class="msg-row">
      <div class="msg-row-h">
        <span><strong>${escapeHtml(m.fromName)}</strong> → <strong>${escapeHtml(m.toName)}</strong></span>
        <span>${new Date(m.ts).toLocaleString()}</span>
      </div>
      <div class="msg-text">${escapeHtml(m.text)}</div>
    </div>
  `).join('');
}

// ---------- API STATUS ----------
async function checkApiStatus() {
  const el = document.getElementById('apiStatus');
  if (!el) return;
  try {
    const r = await fetch(API + '/health');
    if (r.ok) { el.className = 'status-dot ok'; el.innerHTML = '<span></span> Operational'; }
    else throw new Error();
  } catch {
    el.className = 'status-dot err'; el.innerHTML = '<span></span> Offline';
  }
}

// ---------- UTIL ----------
const COLOR_GRADIENTS = [
  'linear-gradient(135deg,#ff6b9d,#c44dff)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#30cfd0,#330867)'
];
function gradFor(id) {
  let h = 0; for (const ch of (id || 'x')) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return COLOR_GRADIENTS[h % COLOR_GRADIENTS.length];
}
function initials(n) { return (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(); }
function escapeHtml(s) { return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return (s + '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 2600);
}

// Auto-refresh overview every 30s
setInterval(() => { if (TOKEN && CURRENT_VIEW === 'overview') refreshAll(); }, 30000);
