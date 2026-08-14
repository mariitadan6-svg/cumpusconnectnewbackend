// ==================== CampusConnect Frontend ====================
const API = window.CC_CONFIG.API_URL;
let TOKEN = localStorage.getItem('cc_token') || null;
let ME = null;
let CURRENT_FILTER = 'all';
let CURRENT_CHAT_USER = null;
let COUNTIES = (window.KENYA_COUNTIES ? JSON.parse(JSON.stringify(window.KENYA_COUNTIES)) : {});
let AGE_CALLBACK = null;

const INTERESTS_LIST = [
  '🎵 Music','🎬 Movies','⚽ Football','📚 Reading','✈️ Travel','🍕 Food',
  '💪 Gym','🎮 Gaming','📸 Photography','🎨 Art','💃 Dance','☕ Coffee',
  '🐕 Dogs','🐱 Cats','🌊 Beach','⛰️ Hiking','💻 Tech','👗 Fashion',
  '🍷 Wine','🎤 Karaoke','🏄 Adventure','🧘 Yoga','📖 Faith','🚗 Cars',
  '📱 Social Media','🎸 Guitar','🍳 Cooking','🌱 Nature','🎯 Fitness','💼 Business'
];

// ---------- FLASH LOADER ----------
const flashSteps = [
  'Igniting the vibe...',
  'Loading Kenya\'s hottest connections...',
  'Warming up matches...',
  'Sprinkling love dust...',
  'Almost there...'
];
let fsi = 0;
const flashStatusEl = document.getElementById('flashStatus');
const flashInterval = setInterval(() => {
  fsi = (fsi + 1) % flashSteps.length;
  if (flashStatusEl) flashStatusEl.textContent = flashSteps[fsi];
}, 500);

window.addEventListener('load', () => {
  setTimeout(async () => {
    clearInterval(flashInterval);
    document.getElementById('flashLoader').classList.add('done');
    setTimeout(() => document.getElementById('flashLoader').remove(), 700);
    // pre-load counties
    await loadCounties();
    // Route
    if (TOKEN) {
      const ok = await loadMe();
      if (ok) enterApp();
      else showLanding();
    } else {
      showLanding();
    }
  }, 2600);
});

// ---------- ROUTING ----------
function showLanding(){
  document.getElementById('landing').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('botToggle').classList.remove('hidden');
}
function enterApp(){
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('botToggle').classList.remove('hidden');
  renderProfile();
  loadDiscover();
  loadMatches();
  populateFilterCounties();
}

// ---------- AGE GATE ----------
function requireAgeGate(cb){
  AGE_CALLBACK = cb;
  const gate = document.getElementById('ageGate');
  const cb18 = document.getElementById('ageCheckbox');
  const btn = document.getElementById('ageContinue');
  cb18.checked = false;
  btn.disabled = true;
  gate.classList.remove('hidden');
  cb18.onchange = () => { btn.disabled = !cb18.checked; };
  btn.onclick = () => {
    if (!cb18.checked) return;
    gate.classList.add('hidden');
    if (typeof AGE_CALLBACK === 'function') AGE_CALLBACK();
  };
}
function closeAgeGate(){ document.getElementById('ageGate').classList.add('hidden'); }

// ---------- MODAL SHOWERS ----------
function showLogin(){
  document.getElementById('loginModal').classList.remove('hidden');
}
function showRegister(){
  requireAgeGate(() => {
    document.getElementById('registerModal').classList.remove('hidden');
    populateRegCounties();
    renderInterestTags();
  });
}
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }
function togglePass(id, el){
  const inp = document.getElementById(id);
  if (inp.type === 'password'){ inp.type = 'text'; el.classList.remove('fa-eye'); el.classList.add('fa-eye-slash'); }
  else { inp.type = 'password'; el.classList.remove('fa-eye-slash'); el.classList.add('fa-eye'); }
}

// ---------- API ----------
async function api(path, opts = {}){
  opts.headers = opts.headers || {};
  opts.headers['Content-Type'] = 'application/json';
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
  const r = await fetch(API + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- COUNTIES ----------
async function loadCounties(){
  // We ALWAYS have the bundled fallback in COUNTIES, so dropdowns work instantly.
  // Then we try to refresh from the API in the background.
  try {
    const data = await fetch(API + '/api/meta/all').then(r=>r.json());
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      COUNTIES = data;
      // Re-populate any currently-open dropdowns with fresh data
      const regSel = document.getElementById('regCounty');
      if (regSel && regSel.options.length <= 1) populateRegCounties(true);
      const filSel = document.getElementById('filterCounty');
      if (filSel && filSel.options.length <= 1) populateFilterCounties(true);
    }
  } catch(e){
    console.warn('counties API load failed, using bundled data', e);
  }
}
function populateRegCounties(force){
  const sel = document.getElementById('regCounty');
  if (!sel) return;
  if (!force && sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Select County</option>';
  const keys = Object.keys(COUNTIES).sort();
  keys.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}
function loadSubcounties(){
  const c = document.getElementById('regCounty').value;
  const sel = document.getElementById('regSubcounty');
  sel.innerHTML = '<option value="">Subcounty</option>';
  if (!c || !COUNTIES[c]) return;
  COUNTIES[c].forEach(sc => {
    const o = document.createElement('option'); o.value = sc; o.textContent = sc;
    sel.appendChild(o);
  });
}
function populateFilterCounties(force){
  const sel = document.getElementById('filterCounty');
  if (!sel) return;
  if (!force && sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Any County</option>';
  Object.keys(COUNTIES).sort().forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    const scSel = document.getElementById('filterSubcounty');
    scSel.innerHTML = '<option value="">Any Subcounty</option>';
    const c = sel.value;
    if (c && COUNTIES[c]){
      COUNTIES[c].forEach(sc => {
        const o = document.createElement('option'); o.value = sc; o.textContent = sc;
        scSel.appendChild(o);
      });
    }
    applyFilters();
  };
}

// ---------- INTEREST TAGS ----------
let SELECTED_INTERESTS = [];
function renderInterestTags(){
  const box = document.getElementById('interestTags');
  box.innerHTML = '';
  INTERESTS_LIST.forEach(i => {
    const t = document.createElement('div');
    t.className = 'itag';
    t.textContent = i;
    t.onclick = () => {
      t.classList.toggle('active');
      const label = i;
      if (t.classList.contains('active')) SELECTED_INTERESTS.push(label);
      else SELECTED_INTERESTS = SELECTED_INTERESTS.filter(x => x !== label);
    };
    box.appendChild(t);
  });
}

// ---------- REG STEP NAV ----------
function regNext(step){
  // basic validation per step
  if (step === 1){
    const name = document.getElementById('regName').value.trim();
    const age = Number(document.getElementById('regAge').value);
    const gender = document.getElementById('regGender').value;
    const intIn = document.getElementById('regInterestedIn').value;
    if (!name || !age || !gender || !intIn) return toast('Please fill all fields', 'error');
    if (age < 18) return toast('You must be 18+', 'error');
  }
  if (step === 2){
    const vibe = document.querySelector('input[name="lookingFor"]:checked');
    const c = document.getElementById('regCounty').value;
    const sc = document.getElementById('regSubcounty').value;
    if (!vibe) return toast('Pick a vibe', 'error');
    if (!c || !sc) return toast('Pick county & subcounty', 'error');
  }
  setRegStep(step + 1);
}
function regBack(step){ setRegStep(step - 1); }
function setRegStep(n){
  document.querySelectorAll('.reg-step').forEach(s => s.classList.remove('active'));
  document.querySelector(`.reg-step[data-step="${n}"]`).classList.add('active');
  for (let i=1;i<=4;i++){
    const sb = document.querySelector('.sb'+i);
    sb.classList.remove('active','done');
    if (i < n) sb.classList.add('done');
    if (i === n) sb.classList.add('active');
  }
}

// ---------- REGISTER ----------
async function handleRegister(e){
  e.preventDefault();
  const err = document.getElementById('registerError');
  err.classList.remove('show');
  const pw = document.getElementById('regPassword').value;
  const pw2 = document.getElementById('regPassword2').value;
  if (pw !== pw2){ err.textContent = 'Passwords do not match'; err.classList.add('show'); return; }
  if (!document.getElementById('regAge18').checked){ err.textContent = 'Please confirm you are 18+'; err.classList.add('show'); return; }

  const body = {
    name: document.getElementById('regName').value.trim(),
    age: Number(document.getElementById('regAge').value),
    gender: document.getElementById('regGender').value,
    interestedIn: document.getElementById('regInterestedIn').value,
    lookingFor: document.querySelector('input[name="lookingFor"]:checked').value,
    county: document.getElementById('regCounty').value,
    subcounty: document.getElementById('regSubcounty').value,
    bio: document.getElementById('regBio').value.trim(),
    interests: SELECTED_INTERESTS.slice(),
    email: document.getElementById('regEmail').value.trim(),
    password: pw,
    confirmAge18: true
  };
  try {
    const data = await api('/api/auth/register', { method: 'POST', body });
    TOKEN = data.token; ME = data.user;
    localStorage.setItem('cc_token', TOKEN);
    closeModal('registerModal');
    toast('Welcome to CampusConnect, ' + ME.name + '! 🎉', 'success');
    enterApp();
  } catch(ex){
    err.textContent = ex.message;
    err.classList.add('show');
  }
}

// ---------- LOGIN ----------
async function handleLogin(e){
  e.preventDefault();
  const err = document.getElementById('loginError');
  err.classList.remove('show');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value
      }
    });
    TOKEN = data.token; ME = data.user;
    localStorage.setItem('cc_token', TOKEN);
    closeModal('loginModal');
    toast('Welcome back, ' + ME.name + '! ❤️', 'success');
    enterApp();
  } catch(ex){
    err.textContent = ex.message;
    err.classList.add('show');
  }
}

async function loadMe(){
  try { ME = await api('/api/users/me'); return true; }
  catch { TOKEN = null; localStorage.removeItem('cc_token'); return false; }
}

function logout(){
  TOKEN = null; ME = null;
  localStorage.removeItem('cc_token');
  showLanding();
  toast('Logged out', 'success');
}

// ---------- TABS ----------
document.querySelectorAll('.app-nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.app-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'matches') loadMatches();
    if (btn.dataset.tab === 'chat') loadChatList();
    if (btn.dataset.tab === 'profile') renderProfile();
    if (btn.dataset.tab === 'discover') applyFilters();
  };
});

// ---------- DISCOVER ----------
document.querySelectorAll('.filter-chips .chip').forEach(c => {
  c.onclick = () => {
    document.querySelectorAll('.filter-chips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    CURRENT_FILTER = c.dataset.filter;
    applyFilters();
  };
});

async function loadDiscover(){ applyFilters(); }
async function applyFilters(){
  if (!TOKEN) return;
  const params = new URLSearchParams();
  if (CURRENT_FILTER !== 'all') params.set('lookingFor', CURRENT_FILTER);
  const c = document.getElementById('filterCounty').value;
  const sc = document.getElementById('filterSubcounty').value;
  if (c) params.set('county', c);
  if (sc) params.set('subcounty', sc);
  try {
    const list = await api('/api/users/discover?' + params.toString());
    renderDiscover(list);
  } catch(e){ toast(e.message, 'error'); }
}

const COLOR_GRADIENTS = [
  'linear-gradient(135deg,#ff6b9d,#c44dff)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#30cfd0,#330867)',
  'linear-gradient(135deg,#a8edea,#fed6e3)',
  'linear-gradient(135deg,#ffecd2,#fcb69f)'
];
function gradFor(id){
  let h = 0; for (const ch of (id||'x')) h = (h*31 + ch.charCodeAt(0)) & 0xffff;
  return COLOR_GRADIENTS[h % COLOR_GRADIENTS.length];
}
function initials(n){ return (n||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(); }

function renderDiscover(list){
  const grid = document.getElementById('discoverGrid');
  const empty = document.getElementById('discoverEmpty');
  grid.innerHTML = '';
  if (!list.length){ empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  list.forEach(u => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="uc-photo" style="background:${gradFor(u.id)}">
        <div class="uc-badge ${u.lookingFor}">${u.lookingFor}</div>
        <span style="position:relative;z-index:1">${initials(u.name)}</span>
      </div>
      <div class="uc-body">
        <div class="uc-name"><strong>${escapeHtml(u.name)}</strong><span class="age">${u.age}</span></div>
        <div class="uc-meta"><i class="fa-solid fa-location-dot"></i>${escapeHtml(u.subcounty)}, ${escapeHtml(u.county)}</div>
        <div class="uc-bio">${escapeHtml(u.bio || 'No bio yet.')}</div>
        <div class="uc-tags">${(u.interests||[]).slice(0,4).map(i=>`<span class="uc-tag">${escapeHtml(i)}</span>`).join('')}</div>
        ${u.sharedInterests>0?`<div class="uc-tags"><span class="uc-tag" style="background:rgba(67,233,123,.15);color:#43e97b"><i class="fa-solid fa-sparkles"></i> ${u.sharedInterests} shared interests</span></div>`:''}
      </div>
      <div class="uc-actions">
        <button class="uc-skip"><i class="fa-solid fa-xmark"></i> Skip</button>
        <button class="uc-like"><i class="fa-solid fa-heart"></i> Like</button>
      </div>
    `;
    card.querySelector('.uc-skip').onclick = () => card.remove();
    card.querySelector('.uc-like').onclick = async () => {
      try {
        const r = await api('/api/users/like/' + u.id, { method: 'POST' });
        if (r.matched){
          const bd = document.createElement('div');
          bd.className = 'match-badge';
          bd.innerHTML = `<i class="fa-solid fa-heart"></i><h3>It's a Match!</h3><p>You matched with ${escapeHtml(u.name)}</p>`;
          card.appendChild(bd);
          setTimeout(() => { card.remove(); loadMatches(); }, 1800);
        } else {
          toast('Liked ' + u.name + ' ❤️', 'success');
          setTimeout(() => card.remove(), 300);
        }
      } catch(e){ toast(e.message, 'error'); }
    };
    grid.appendChild(card);
  });
}

// ---------- MATCHES ----------
async function loadMatches(){
  if (!TOKEN) return;
  try {
    const list = await api('/api/users/matches');
    const grid = document.getElementById('matchesGrid');
    const empty = document.getElementById('matchesEmpty');
    grid.innerHTML = '';
    if (!list.length){ empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.forEach(m => {
      const u = m.user;
      const el = document.createElement('div');
      el.className = 'match-card';
      el.innerHTML = `
        <div class="mc-photo" style="background:${gradFor(u.id)}">${initials(u.name)}</div>
        <div class="mc-body"><strong>${escapeHtml(u.name)}</strong><small>${escapeHtml(u.county)}</small></div>
      `;
      el.onclick = () => openChat(u);
      grid.appendChild(el);
    });
  } catch(e){ console.error(e); }
}

// ---------- CHAT ----------
async function loadChatList(){
  const list = await api('/api/users/matches');
  const box = document.getElementById('chatListItems');
  box.innerHTML = '';
  if (!list.length){
    box.innerHTML = '<p class="muted" style="text-align:center;padding:20px 0">No matches yet</p>';
    return;
  }
  list.forEach(m => {
    const u = m.user;
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.innerHTML = `
      <div class="avatar" style="background:${gradFor(u.id)}">${initials(u.name)}</div>
      <div><strong>${escapeHtml(u.name)}</strong><small>${escapeHtml(u.county)}</small></div>
    `;
    el.onclick = () => {
      document.querySelectorAll('.chat-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      openChat(u);
    };
    box.appendChild(el);
  });
}

async function openChat(user){
  CURRENT_CHAT_USER = user;
  document.querySelector('[data-tab="chat"]').click();
  document.getElementById('chatEmpty').style.display = 'none';
  document.getElementById('chatActive').style.display = 'flex';
  document.getElementById('chatHeader').innerHTML = `
    <div class="avatar" style="background:${gradFor(user.id)}">${initials(user.name)}</div>
    <div><strong>${escapeHtml(user.name)}</strong><br /><small class="muted">${escapeHtml(user.subcounty)}, ${escapeHtml(user.county)}</small></div>
  `;
  await refreshMessages();
}
async function refreshMessages(){
  if (!CURRENT_CHAT_USER) return;
  const list = await api('/api/messages/with/' + CURRENT_CHAT_USER.id);
  const box = document.getElementById('chatMessages');
  box.innerHTML = '';
  list.forEach(m => {
    const el = document.createElement('div');
    el.className = 'msg ' + (m.from === ME.id ? 'mine' : 'theirs');
    el.textContent = m.text;
    box.appendChild(el);
  });
  box.scrollTop = box.scrollHeight;
}
async function sendMessage(e){
  e.preventDefault();
  const inp = document.getElementById('chatText');
  const text = inp.value.trim();
  if (!text || !CURRENT_CHAT_USER) return;
  inp.value = '';
  try {
    await api('/api/messages/send', { method: 'POST', body: { to: CURRENT_CHAT_USER.id, text } });
    await refreshMessages();
  } catch(e){ toast(e.message, 'error'); }
}

// ---------- PROFILE ----------
function renderProfile(){
  if (!ME) return;
  document.getElementById('profileAvatar').style.background = gradFor(ME.id);
  document.getElementById('profileAvatar').textContent = initials(ME.name);
  document.getElementById('profileName').textContent = ME.name;
  document.getElementById('profileEmail').textContent = ME.email;
  document.getElementById('profileAge').textContent = ME.age + ' years';
  document.getElementById('profileLocation').textContent = `${ME.subcounty}, ${ME.county}`;
  const vibeLabel = { hookup: '🔥 Hookup', friendship: '🤝 Friendship', dating: '❤️ Dating' }[ME.lookingFor] || ME.lookingFor;
  document.getElementById('profileVibe').textContent = vibeLabel;
  document.getElementById('profileBio').textContent = ME.bio || 'No bio yet.';
  const tags = document.getElementById('profileInterests');
  tags.innerHTML = (ME.interests||[]).map(i => `<span>${escapeHtml(i)}</span>`).join('');
}

// ---------- CHATBOT ----------
function toggleBot(){
  const w = document.getElementById('botWindow');
  w.classList.toggle('hidden');
  if (!w.classList.contains('hidden')){
    setTimeout(() => document.getElementById('botInput').focus(), 100);
  }
}
async function sendBotMsg(e){
  e.preventDefault();
  const inp = document.getElementById('botInput');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  const box = document.getElementById('botMessages');
  const um = document.createElement('div');
  um.className = 'bot-msg user'; um.innerHTML = `<span>${escapeHtml(text)}</span>`;
  box.appendChild(um);
  box.scrollTop = box.scrollHeight;

  const typing = document.createElement('div');
  typing.className = 'bot-msg typing bot'; typing.innerHTML = '<span>Cupid is typing</span>';
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;

  try {
    const data = await fetch(API + '/api/chatbot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    }).then(r => r.json());
    typing.remove();
    const bm = document.createElement('div');
    bm.className = 'bot-msg bot'; bm.innerHTML = `<span>${escapeHtml(data.reply)}</span>`;
    box.appendChild(bm);
    box.scrollTop = box.scrollHeight;
  } catch (err){
    typing.remove();
    const bm = document.createElement('div');
    bm.className = 'bot-msg bot'; bm.innerHTML = '<span>Oops, I couldn\'t reach the server. Please try again.</span>';
    box.appendChild(bm);
  }
}

// ---------- UTIL ----------
function toast(msg, type='success'){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 2600);
}
function escapeHtml(s){
  return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Scroll animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting){
      e.target.style.opacity = 1;
      e.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('[data-anim="fade"]').forEach(el => {
  el.style.opacity = 0;
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'all 0.6s cubic-bezier(0.4,0,0.2,1)';
  observer.observe(el);
});
