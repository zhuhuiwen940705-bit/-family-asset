'use strict';
/* 家庭资产管理 - 前端单页应用 */

const API = {
  token: localStorage.getItem('token') || null,
  async call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const res = await fetch('/api' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  },
  get(p) { return this.call('GET', p); },
  post(p, b) { return this.call('POST', p, b); },
  put(p, b) { return this.call('PUT', p, b); },
  del(p) { return this.call('DELETE', p); },
};

const State = {
  user: null, family: null,
  items: [], categories: [],
  tab: 'items',
  filterCat: 'all', search: '',
};

const EMOJIS = ['🥬','🍎','🥩','🍞','🧂','🛢️','🍷','🍺','🥤','☕','🧴','🧼','🧻','🧽','🪥','💊','🩹','🌡️','🍼','🧸','📦','🔋','💡','🛠️','🧦','📚','🐱','🌿'];

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

// ---------- 工具 ----------
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = 'toast'), 2200);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function catOf(id) { return State.categories.find((c) => c.id === id); }
function initials(name) { return (name || '?').trim().slice(0, 1).toUpperCase(); }

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
function itemStatus(it) {
  const flags = [];
  if (it.quantity <= 0) flags.push({ cls: 'out', text: '已用完' });
  else if (it.threshold > 0 && it.quantity <= it.threshold) flags.push({ cls: 'low', text: '需补货' });
  const du = daysUntil(it.expiry);
  if (du !== null) {
    if (du < 0) flags.push({ cls: 'exp', text: '已过期' });
    else if (du <= 7) flags.push({ cls: 'soon', text: du === 0 ? '今天到期' : `剩${du}天` });
  }
  return flags;
}
function needRestock(it) { return it.quantity <= 0 || (it.threshold > 0 && it.quantity <= it.threshold); }
function expiringSoon(it) { const d = daysUntil(it.expiry); return d !== null && d <= 7; }

// ---------- 鉴权流程 ----------
function renderAuth(mode = 'login') {
  app.innerHTML = `
  <div class="auth">
    <div class="auth-logo">
      <div class="emoji">🏠</div>
      <h1>家庭资产管理</h1>
      <p>家里有啥、还剩多少，一目了然</p>
    </div>
    <div class="auth-card">
      <div class="auth-tabs">
        <button data-m="login" class="${mode==='login'?'active':''}">登录</button>
        <button data-m="register" class="${mode==='register'?'active':''}">创建家庭</button>
        <button data-m="join" class="${mode==='join'?'active':''}">加入家庭</button>
      </div>
      <form id="authForm">${authFields(mode)}</form>
    </div>
  </div>`;

  app.querySelectorAll('.auth-tabs button').forEach((b) =>
    b.onclick = () => renderAuth(b.dataset.m));
  $('#authForm').onsubmit = (e) => { e.preventDefault(); submitAuth(mode); };
}

function authFields(mode) {
  const common = `
    <div class="field"><label>用户名</label><input name="username" autocomplete="username" placeholder="登录账号，至少3位" /></div>
    <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" placeholder="至少6位" /></div>`;
  if (mode === 'login') {
    return common + `<button type="submit" class="btn">登录</button>`;
  }
  if (mode === 'register') {
    return `
      <div class="field"><label>家庭名称</label><input name="familyName" placeholder="如：张家的小窝" /></div>
      <div class="field"><label>你的昵称</label><input name="displayName" placeholder="如：爸爸 / 妈妈" /></div>
      ${common}
      <button type="submit" class="btn">创建家庭并成为管理员</button>
      <div class="field" style="margin-top:10px"><div class="hint" style="text-align:center">创建后会生成邀请码，分享给家人即可加入</div></div>`;
  }
  // join
  return `
    <div class="field"><label>邀请码</label><input name="inviteCode" placeholder="6位邀请码" style="text-transform:uppercase;letter-spacing:3px" /></div>
    <div class="field"><label>你的昵称</label><input name="displayName" placeholder="如：奶奶 / 小明" /></div>
    ${common}
    <button type="submit" class="btn">加入家庭</button>`;
}

async function submitAuth(mode) {
  const f = $('#authForm');
  const v = (n) => (f[n]?.value || '').trim();
  const btn = f.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    let r;
    if (mode === 'login') r = await API.post('/login', { username: v('username'), password: v('password') });
    else if (mode === 'register') r = await API.post('/register', { username: v('username'), password: v('password'), displayName: v('displayName'), familyName: v('familyName') });
    else r = await API.post('/join', { username: v('username'), password: v('password'), displayName: v('displayName'), inviteCode: v('inviteCode') });
    API.token = r.token; localStorage.setItem('token', r.token);
    State.user = r.user; State.family = r.family;
    toast(mode === 'login' ? '欢迎回来' : '欢迎加入 ' + r.family.name);
    await loadData(); renderMain();
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false; btn.textContent = orig;
  }
}

function logout() {
  API.token = null; localStorage.removeItem('token');
  State.user = State.family = null; State.items = []; State.categories = [];
  renderAuth('login');
}

// ---------- 数据加载 ----------
async function loadData() {
  const [c, i] = await Promise.all([API.get('/categories'), API.get('/items')]);
  State.categories = c.categories; State.items = i.items;
}

// ---------- 主框架 ----------
function renderMain() {
  app.innerHTML = `<div id="screen" class="screen"></div>${navBar()}`;
  bindNav();
  renderTab();
}
function bindNav() {
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.onclick = () => { State.tab = b.dataset.tab; renderMain(); });
  const fab = $('#fab'); if (fab) fab.onclick = () => openItemModal();
}
function navBar() {
  const ic = {
    items: '<path d="M3 7h18M3 12h18M3 17h18"/>',
    alerts: '<path d="M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0"/>',
    family: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.2"/><path d="M16 20c0-2 1-3.5 3-4"/>',
    me: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
  };
  const alertCount = State.items.filter(needRestock).length + State.items.filter(expiringSoon).length;
  const n = (t, label, badge) => `<div class="nav-item ${State.tab===t?'active':''}" data-tab="${t}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ic[t]}</svg><span>${label}</span>${badge?`<span class="nav-badge">${badge>99?'99+':badge}</span>`:''}</div>`;
  return `<nav class="bottom-nav">
    ${n('items','资产')}
    ${n('alerts','提醒', alertCount)}
    <div class="nav-fab"><button id="fab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>
    ${n('family','家庭')}
    ${n('me','我的')}
  </nav>`;
}

function renderTab() {
  const s = $('#screen');
  if (State.tab === 'items') return renderItems(s);
  if (State.tab === 'alerts') return renderAlerts(s);
  if (State.tab === 'family') return renderFamily(s);
  if (State.tab === 'me') return renderMe(s);
}

// ---------- 资产页 ----------
function renderItems(s) {
  const total = State.items.length;
  const low = State.items.filter(needRestock).length;
  const exp = State.items.filter(expiringSoon).length;

  const cats = State.categories.map((c) => {
    const cnt = State.items.filter((i) => i.categoryId === c.id).length;
    return `<button class="chip ${State.filterCat===c.id?'active':''}" data-cat="${c.id}">${c.icon} ${esc(c.name)} <span class="count">${cnt}</span></button>`;
  }).join('');

  s.innerHTML = `
    <div class="topbar">
      <h2>🏠 ${esc(State.family.name)}</h2>
      <div class="sub">共 ${total} 件物品 · ${low?`<span style="color:var(--warn)">${low} 件需补货</span>`:'库存充足'}</div>
      <div class="search-row">
        <div class="search-bar">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input id="search" placeholder="搜索物品名、位置、备注…" value="${esc(State.search)}" />
          ${State.search?'<button class="clear" id="clearS">×</button>':''}
        </div>
        <button class="mic-btn" id="micBtn" title="语音录入"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="num">${total}</div><div class="lbl">总物品</div></div>
      <div class="stat warn"><div class="num">${low}</div><div class="lbl">需补货</div></div>
      <div class="stat danger"><div class="num">${exp}</div><div class="lbl">临期</div></div>
    </div>
    <div class="chips">
      <button class="chip ${State.filterCat==='all'?'active':''}" data-cat="all">全部</button>
      ${cats}
    </div>
    <div class="content" id="itemList"></div>`;

  const search = $('#search');
  search.oninput = () => { State.search = search.value; drawItemList(); };
  const cs = $('#clearS'); if (cs) cs.onclick = () => { State.search = ''; renderItems(s); };
  const mic = $('#micBtn'); if (mic) mic.onclick = startVoice;
  s.querySelectorAll('[data-cat]').forEach((c) =>
    c.onclick = () => { State.filterCat = c.dataset.cat; renderItems(s); });
  drawItemList();
}

function filteredItems() {
  const q = State.search.trim().toLowerCase();
  return State.items.filter((it) => {
    if (State.filterCat !== 'all' && it.categoryId !== State.filterCat) return false;
    if (q) {
      const hay = (it.name + ' ' + it.location + ' ' + it.note).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function drawItemList() {
  const list = $('#itemList');
  const items = filteredItems();
  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="emoji">${State.search?'🔍':'📦'}</div><p>${State.search?'没有找到匹配的物品':'还没有物品，点下方 ➕ 添加'}</p></div>`;
    return;
  }
  // 按分类分组展示
  const groups = {};
  items.forEach((it) => { (groups[it.categoryId] ||= []).push(it); });
  const order = State.categories.filter((c) => groups[c.id]);
  list.innerHTML = order.map((c) => {
    const rows = groups[c.id]
      .sort((a, b) => Number(needRestock(b)) - Number(needRestock(a)) || a.name.localeCompare(b.name, 'zh'))
      .map(itemCard).join('');
    return `<div class="cat-group"><div class="cat-head"><span class="ic">${c.icon}</span>${esc(c.name)}<span class="cnt">${groups[c.id].length}</span></div>${rows}</div>`;
  }).join('');

  list.querySelectorAll('[data-edit]').forEach((el) =>
    el.onclick = (e) => { if (e.target.closest('.qty-ctrl')) return; openItemModal(el.dataset.edit); });
  list.querySelectorAll('[data-adj]').forEach((b) =>
    b.onclick = (e) => { e.stopPropagation(); adjustQty(b.dataset.adj, Number(b.dataset.d)); });
}

function itemCard(it) {
  const cat = catOf(it.categoryId);
  const flags = itemStatus(it);
  const badges = flags.map((f) => `<span class="badge ${f.cls}">${f.text}</span>`).join('');
  const metas = [];
  if (it.location) metas.push(`<span class="tag">📍${esc(it.location)}</span>`);
  if (it.expiry) metas.push(`<span class="tag">📅${esc(it.expiry)}</span>`);
  if (it.autoConsume > 0 && it.consumePeriod) {
    const pl = { day: '每天', week: '每周', month: '每月' }[it.consumePeriod] || '';
    metas.push(`<span class="tag" style="color:var(--primary)">⏱${pl}-${it.autoConsume}${esc(it.unit)}</span>`);
  }
  metas.push(`<span class="tag" style="color:var(--text-faint)">${esc(it.updatedByName)}更新</span>`);
  return `
  <div class="item" data-edit="${it.id}">
    <div class="item-emoji">${cat ? cat.icon : '📦'}</div>
    <div class="item-main">
      <div class="item-name"><span class="nm">${esc(it.name)}</span></div>
      <div class="item-meta">${badges}${metas.join('')}</div>
    </div>
    <div class="qty-ctrl">
      <button class="qty-btn minus" data-adj="${it.id}" data-d="-1">−</button>
      <div><div class="qty-val">${it.quantity}</div><div class="qty-unit" style="text-align:center">${esc(it.unit)}</div></div>
      <button class="qty-btn" data-adj="${it.id}" data-d="1">+</button>
    </div>
  </div>`;
}

async function adjustQty(itemId, delta) {
  const it = State.items.find((i) => i.id === itemId);
  if (!it) return;
  const prev = it.quantity;
  it.quantity = Math.max(0, it.quantity + delta); // 乐观更新
  refreshQtyUI(it);
  try {
    const r = await API.post(`/items/${itemId}/adjust`, { delta });
    Object.assign(it, r.item);
    refreshQtyUI(it);
    updateBadgeCounts();
  } catch (e) { it.quantity = prev; refreshQtyUI(it); toast(e.message, true); }
}
function refreshQtyUI(it) {
  // 局部刷新该卡片的数量与状态徽标
  const card = document.querySelector(`.item[data-edit="${it.id}"]`);
  if (!card) return;
  card.querySelector('.qty-val').textContent = it.quantity;
  const flags = itemStatus(it);
  const metaEl = card.querySelector('.item-meta');
  metaEl.querySelectorAll('.badge').forEach((b) => b.remove());
  // 状态徽标插到信息行最前面
  flags.slice().reverse().forEach((f) => { const b = document.createElement('span'); b.className = 'badge ' + f.cls; b.textContent = f.text; metaEl.insertBefore(b, metaEl.firstChild); });
}
function updateBadgeCounts() {
  // 更新顶部统计和底部提醒角标（轻量重绘导航）
  const navOld = app.querySelector('.bottom-nav');
  if (navOld) { const wrap = document.createElement('div'); wrap.innerHTML = navBar(); navOld.replaceWith(wrap.firstElementChild); bindNav(); }
  if (State.tab === 'items') {
    const total = State.items.length, low = State.items.filter(needRestock).length, exp = State.items.filter(expiringSoon).length;
    const stats = app.querySelectorAll('.stat .num');
    if (stats.length === 3) { stats[0].textContent = total; stats[1].textContent = low; stats[2].textContent = exp; }
  }
}

// ---------- 提醒页 ----------
function renderAlerts(s) {
  const restock = State.items.filter(needRestock).sort((a, b) => a.quantity - b.quantity);
  const expiring = State.items.filter((i) => { const d = daysUntil(i.expiry); return d !== null && d <= 30; }).sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));

  const section = (title, emoji, list, fmt) => {
    if (!list.length) return '';
    return `<div class="section-title">${emoji} ${title}（${list.length}）</div>` +
      list.map((it) => {
        const cat = catOf(it.categoryId);
        return `<div class="item" data-edit="${it.id}">
          <div class="item-emoji">${cat?cat.icon:'📦'}</div>
          <div class="item-main"><div class="item-name"><span class="nm">${esc(it.name)}</span></div>
          <div class="item-meta">${fmt(it)}${it.location?` · 📍${esc(it.location)}`:''}</div></div>
          <div class="qty-ctrl"><span class="qty-val">${it.quantity}</span><span class="qty-unit">${esc(it.unit)}</span></div>
        </div>`;
      }).join('');
  };

  let html = `<div class="topbar"><h2>🔔 补货 & 临期提醒</h2><div class="sub">把这些加进购物清单吧</div></div><div class="content">`;
  if (!restock.length && !expiring.length) {
    html += `<div class="empty"><div class="emoji">✅</div><p>太好了，暂时没有需要补货或临期的物品</p></div>`;
  } else {
    html += section('需要补货', '🛒', restock, (it) => it.quantity <= 0 ? '<b style="color:var(--danger)">已用完</b>' : `仅剩 ${it.quantity}${esc(it.unit)}（阈值${it.threshold}）`);
    html += section('临期 / 过期', '⏰', expiring, (it) => { const d = daysUntil(it.expiry); return d < 0 ? `<b style="color:var(--danger)">已过期${-d}天</b>` : d === 0 ? '<b style="color:var(--danger)">今天到期</b>' : `还有 ${d} 天到期`; });
  }
  html += '</div>';
  s.innerHTML = html;
  s.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () => openItemModal(el.dataset.edit));
}

// ---------- 家庭页 ----------
async function renderFamily(s) {
  s.innerHTML = `<div class="topbar"><h2>👨‍👩‍👧 家庭管理</h2></div><div class="content"><div class="center-load"><span class="spinner"></span></div></div>`;
  let fam;
  try { fam = await API.get('/family'); } catch (e) { toast(e.message, true); return; }
  const isAdmin = State.user.role === 'admin';
  const content = $('.content', s);
  content.innerHTML = `
    ${isAdmin ? `<div class="invite-box">
      <div class="lbl">家庭邀请码</div>
      <div class="code">${fam.family.inviteCode}</div>
      <div class="tip">家人在「加入家庭」输入此码即可加入</div>
      <div class="actions"><button id="copyInvite">📋 复制邀请码</button><button id="resetInvite">🔄 重置</button></div>
    </div>` : `<div class="invite-box"><div class="lbl">所属家庭</div><div class="code" style="font-size:24px;letter-spacing:1px">${esc(fam.family.name)}</div><div class="tip">如需邀请新成员，请联系管理员</div></div>`}
    <div class="section-title">家庭成员（${fam.members.length}）</div>
    <div class="list-card">${fam.members.map((m) => memberRow(m, isAdmin)).join('')}</div>
    ${isAdmin ? `<div class="section-title">分类管理</div>
      <div class="list-card">${State.categories.map(catRow).join('')}</div>
      <button class="btn btn-ghost" id="addCat">＋ 新增分类</button>` : ''}`;

  if (isAdmin) {
    $('#copyInvite').onclick = () => copyText(fam.family.inviteCode, '邀请码已复制');
    $('#resetInvite').onclick = async () => { if (!confirm('重置后旧邀请码失效，确定？')) return; try { await API.post('/family/reset-invite'); toast('已重置'); renderFamily(s); } catch (e) { toast(e.message, true); } };
    $('#addCat').onclick = () => openCategoryModal();
    content.querySelectorAll('[data-mrole]').forEach((b) => b.onclick = () => toggleRole(b.dataset.mrole, b.dataset.role, s));
    content.querySelectorAll('[data-mdel]').forEach((b) => b.onclick = () => removeMember(b.dataset.mdel, s));
    content.querySelectorAll('[data-cedit]').forEach((b) => b.onclick = () => openCategoryModal(b.dataset.cedit));
    content.querySelectorAll('[data-cdel]').forEach((b) => b.onclick = () => deleteCategory(b.dataset.cdel, s));
  }
}
function memberRow(m, isAdmin) {
  const me = m.id === State.user.id;
  const ctrl = isAdmin && !me
    ? `<div class="act" style="display:flex;gap:6px">
        <button class="icon-btn" data-mrole="${m.id}" data-role="${m.role==='admin'?'member':'admin'}" title="切换角色">${m.role==='admin'?'⬇️':'⬆️'}</button>
        <button class="icon-btn" data-mdel="${m.id}" style="color:var(--danger)" title="移除">✕</button></div>`
    : `<span class="role-tag ${m.role}">${m.role==='admin'?'管理员':'成员'}</span>`;
  return `<div class="list-row"><div class="avatar">${initials(m.displayName)}</div>
    <div class="info"><div class="nm">${esc(m.displayName)} ${me?'<span style="color:var(--text-faint);font-size:12px">(我)</span>':''}</div>
    <div class="sb">@${esc(m.username)} · ${m.role==='admin'?'管理员':'成员'}</div></div>${ctrl}</div>`;
}
function catRow(c) {
  const cnt = State.items.filter((i) => i.categoryId === c.id).length;
  return `<div class="list-row"><div class="avatar" style="background:var(--bg)">${c.icon}</div>
    <div class="info"><div class="nm">${esc(c.name)}</div><div class="sb">${cnt} 件物品</div></div>
    <div class="act" style="display:flex;gap:6px"><button class="icon-btn" data-cedit="${c.id}">✏️</button><button class="icon-btn" data-cdel="${c.id}" style="color:var(--danger)">🗑️</button></div></div>`;
}
async function toggleRole(uid, role, s) {
  try { await API.post(`/family/members/${uid}/role`, { role }); toast('已更新角色'); renderFamily(s); }
  catch (e) { toast(e.message, true); }
}
async function removeMember(uid, s) {
  if (!confirm('确定移除该成员？其账号将被删除。')) return;
  try { await API.del(`/family/members/${uid}`); toast('已移除'); renderFamily(s); }
  catch (e) { toast(e.message, true); }
}
async function deleteCategory(cid, s) {
  if (!confirm('确定删除该分类？')) return;
  try { await API.del(`/categories/${cid}`); State.categories = State.categories.filter((c) => c.id !== cid); toast('已删除'); renderFamily(s); }
  catch (e) { toast(e.message, true); }
}

// ---------- 我的页 ----------
function renderMe(s) {
  s.innerHTML = `<div class="topbar"><h2>👤 我的</h2></div><div class="content">
    <div class="list-card">
      <div class="list-row"><div class="avatar" style="width:52px;height:52px;font-size:20px">${initials(State.user.displayName)}</div>
        <div class="info"><div class="nm" style="font-size:17px">${esc(State.user.displayName)}</div>
        <div class="sb">@${esc(State.user.username)} · ${State.user.role==='admin'?'管理员':'成员'} · ${esc(State.family.name)}</div></div></div>
    </div>
    <div class="list-card">
      <button class="list-row" id="editName" style="width:100%;text-align:left"><div class="info"><div class="nm">修改昵称</div></div><span style="color:var(--text-faint)">›</span></button>
      <button class="list-row" id="editPwd" style="width:100%;text-align:left"><div class="info"><div class="nm">修改密码</div></div><span style="color:var(--text-faint)">›</span></button>
    </div>
    <button class="btn btn-danger" id="logout">退出登录</button>
    <p style="text-align:center;color:var(--text-faint);font-size:12px;margin-top:20px">家庭资产管理 · 数据保存在你自己的服务器</p>
  </div>`;
  $('#logout').onclick = () => { if (confirm('确定退出登录？')) logout(); };
  $('#editName').onclick = editName;
  $('#editPwd').onclick = editPwd;
}
function editName() {
  openModal(`<h3>修改昵称</h3>
    <div class="field"><label>昵称</label><input id="dn" value="${esc(State.user.displayName)}" /></div>
    <button class="btn" id="save">保存</button>`, () => {
    $('#save').onclick = async () => {
      const v = $('#dn').value.trim(); if (!v) return toast('昵称不能为空', true);
      try { const r = await API.post('/me/profile', { displayName: v }); State.user = r.user; closeModal(); toast('已保存'); renderMain(); } catch (e) { toast(e.message, true); }
    };
  });
}
function editPwd() {
  openModal(`<h3>修改密码</h3>
    <div class="field"><label>原密码</label><input id="op" type="password" /></div>
    <div class="field"><label>新密码</label><input id="np" type="password" placeholder="至少6位" /></div>
    <button class="btn" id="save">保存</button>`, () => {
    $('#save').onclick = async () => {
      try { await API.post('/me/password', { oldPassword: $('#op').value, newPassword: $('#np').value }); closeModal(); toast('密码已修改'); } catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- 物品弹窗 ----------
function openItemModal(itemId) {
  const it = itemId ? State.items.find((i) => i.id === itemId) : null;
  const cats = State.categories;
  const defaultCat = it ? it.categoryId : (State.filterCat !== 'all' ? State.filterCat : cats[0]?.id);
  openModal(`
    <h3>${it ? '编辑物品' : '添加物品'}</h3>
    <div class="field"><label>物品名称 *</label><input id="i_name" value="${esc(it?.name)}" placeholder="如：抽纸 / 五粮液 / 洗洁精" /></div>
    <div class="field"><label>分类</label><select id="i_cat">${cats.map((c) => `<option value="${c.id}" ${c.id===defaultCat?'selected':''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>数量</label><input id="i_qty" type="number" inputmode="decimal" value="${it?it.quantity:1}" /></div>
      <div class="field"><label>单位</label><input id="i_unit" value="${esc(it?.unit||'件')}" placeholder="件/瓶/包/盒" /></div>
    </div>
    <div class="row2">
      <div class="field"><label>存放位置</label><input id="i_loc" value="${esc(it?.location)}" placeholder="如：厨房橱柜" /></div>
      <div class="field"><label>补货阈值</label><input id="i_thr" type="number" inputmode="decimal" value="${it?it.threshold:0}" placeholder="低于则提醒" /></div>
    </div>
    <div class="field"><label>保质期 / 到期日（可选）</label><input id="i_exp" type="date" value="${esc(it?.expiry)}" /></div>
    <div class="field"><label>自动消耗（可选，按周期自动扣减库存）</label>
      <div class="row2">
        <input id="i_auto" type="number" inputmode="decimal" min="0" value="${it&&it.autoConsume?it.autoConsume:0}" placeholder="每周期消耗量" />
        <select id="i_period">
          <option value="" ${!it||!it.consumePeriod?'selected':''}>不自动</option>
          <option value="day" ${it&&it.consumePeriod==='day'?'selected':''}>每天</option>
          <option value="week" ${it&&it.consumePeriod==='week'?'selected':''}>每周</option>
          <option value="month" ${it&&it.consumePeriod==='month'?'selected':''}>每月</option>
        </select>
      </div>
      <div class="hint">例：厕纸填「1」+「每周」，每过一周自动减 1。需补货时仍会提醒。</div>
    </div>
    <div class="field"><label>备注（可选）</label><textarea id="i_note" placeholder="品牌、规格、购买渠道等">${esc(it?.note)}</textarea></div>
    <div class="btn-row">
      ${it ? '<button class="btn btn-danger" id="del" style="flex:0 0 90px">删除</button>' : ''}
      <button class="btn" id="save">${it ? '保存' : '添加'}</button>
    </div>
  `, () => {
    $('#save').onclick = async () => {
      const body = {
        name: $('#i_name').value.trim(),
        categoryId: $('#i_cat').value,
        quantity: $('#i_qty').value,
        unit: $('#i_unit').value.trim() || '件',
        location: $('#i_loc').value.trim(),
        threshold: $('#i_thr').value,
        expiry: $('#i_exp').value,
        note: $('#i_note').value.trim(),
        autoConsume: $('#i_auto').value,
        consumePeriod: $('#i_period').value,
      };
      if (!body.name) return toast('请填写物品名称', true);
      try {
        if (it) { const r = await API.put(`/items/${it.id}`, body); Object.assign(it, r.item); }
        else { const r = await API.post('/items', body); State.items.push(r.item); }
        closeModal(); toast(it ? '已保存' : '已添加'); renderMain();
      } catch (e) { toast(e.message, true); }
    };
    if (it) $('#del').onclick = async () => {
      if (!confirm('确定删除该物品？')) return;
      try { await API.del(`/items/${it.id}`); State.items = State.items.filter((x) => x.id !== it.id); closeModal(); toast('已删除'); renderMain(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- 分类弹窗 ----------
function openCategoryModal(cid) {
  const c = cid ? State.categories.find((x) => x.id === cid) : null;
  let sel = c ? c.icon : '📦';
  openModal(`
    <h3>${c ? '编辑分类' : '新增分类'}</h3>
    <div class="field"><label>分类名称</label><input id="c_name" value="${esc(c?.name)}" placeholder="如：宠物用品" /></div>
    <div class="field"><label>图标</label><div class="emoji-pick" id="picker">${EMOJIS.map((e) => `<button data-e="${e}" class="${e===sel?'sel':''}">${e}</button>`).join('')}</div></div>
    <button class="btn" id="save">${c ? '保存' : '添加'}</button>
  `, () => {
    $('#picker').querySelectorAll('button').forEach((b) => b.onclick = () => {
      sel = b.dataset.e; $('#picker').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
    });
    $('#save').onclick = async () => {
      const name = $('#c_name').value.trim(); if (!name) return toast('请填写分类名称', true);
      try {
        if (c) { const r = await API.put(`/categories/${c.id}`, { name, icon: sel }); Object.assign(c, r.category); }
        else { const r = await API.post('/categories', { name, icon: sel }); State.categories.push(r.category); }
        closeModal(); toast('已保存');
        State.tab === 'family' ? renderTab() : renderMain();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- 通用弹窗 ----------
function openModal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal"><div class="modal-handle"></div>${html}</div></div>`;
  const mask = $('.modal-mask', root);
  mask.onclick = (e) => { if (e.target === mask) closeModal(); };
  if (onMount) onMount();
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function copyText(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg || '已复制')).catch(() => {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); toast(msg || '已复制'); } catch { toast('复制失败', true); }
    t.remove();
  });
}

// ---------- 语音录入（浏览器语音识别 + 本地规则解析）----------
const VOICE = {
  SUB: ['用掉', '用了', '用过', '用完', '消耗', '少了', '喝了', '喝掉', '吃了', '吃掉', '没了', '拿走', '拿了', '取走', '取出', '扣掉', '扣', '减少', '减'],
  ADD: ['买了', '买回', '买', '购入', '采购', '添加', '新增', '加了', '增加', '补了', '补货', '补', '进了', '多了', '囤了', '囤', '存了'],
  SET: ['还剩', '剩下', '只剩', '剩', '现在有', '现有', '还有', '设为', '设成', '改成', '变成', '现在是', '总共'],
};

function parseChineseNumber(s) {
  if (!s) return null;
  const ar = s.match(/\d+(?:\.\d+)?/);
  if (ar) return parseFloat(ar[0]);
  const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 };
  const m = s.match(/[零〇一二两俩三四五六七八九十百]+半?|半/);
  if (!m) return null;
  let str = m[0], half = 0;
  if (str.endsWith('半')) { half = 0.5; str = str.slice(0, -1); }
  if (str === '') return half || null;
  let section = 0, num = 0;
  for (const ch of str) {
    const v = map[ch];
    if (v === undefined) continue;
    if (v === 10 || v === 100) { section += (num === 0 ? 1 : num) * v; num = 0; }
    else num = v;
  }
  const total = section + num + half;
  return total || null;
}

function matchVoiceItem(seg, items) {
  let best = null, bestLen = 0;
  for (const it of items) if (it.name && seg.includes(it.name) && it.name.length > bestLen) { best = it; bestLen = it.name.length; }
  if (best) return best;
  // 模糊匹配（容忍识别误差）：按字符重合度，阈值偏高避免"抽纸/厕纸"这类单字误匹配
  let bestScore = 0;
  for (const it of items) {
    const chars = [...new Set((it.name || '').split(''))];
    if (!chars.length) continue;
    const hit = chars.filter((c) => seg.includes(c)).length;
    const score = hit / chars.length;
    if (score > bestScore && score >= 0.67) { bestScore = score; best = it; }
  }
  return best;
}

function detectAction(seg) {
  for (const k of VOICE.SET) if (seg.includes(k)) return 'set';
  for (const k of VOICE.SUB) if (seg.includes(k)) return 'sub';
  for (const k of VOICE.ADD) if (seg.includes(k)) return 'add';
  return 'set'; // 没有动作词时默认理解为"设为"（用户确认前可取消）
}

function parseVoiceCommand(text, items) {
  const segs = text.split(/[，,。；;、\s]+|还有|然后|再有|再/).map((x) => x.trim()).filter(Boolean);
  const EMPTY = ['没了', '没有了', '用完', '用光', '光了', '空了', '喝完', '吃完', '清空'];
  const ops = [];
  for (const seg of segs) {
    let qty = parseChineseNumber(seg);
    const isEmpty = qty === null && EMPTY.some((w) => seg.includes(w));
    if (isEmpty) qty = 0;
    const item = matchVoiceItem(seg, items);
    if (qty === null || !item) continue;
    const action = isEmpty ? 'set' : detectAction(seg);
    const before = item.quantity;
    let after;
    if (action === 'add') after = before + qty;
    else if (action === 'sub') after = Math.max(0, before - qty);
    else after = qty;
    ops.push({ itemId: item.id, name: item.name, unit: item.unit, action, qty, before, after });
  }
  return ops;
}

// 录音 → 转 16k 单声道 wav → 发后端（百度语音）转文字。国内可用，不依赖浏览器自带识别。
let _mediaRecorder = null, _audioStream = null, _voiceCancelled = false;
async function startVoice() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    toast('此浏览器不支持录音，请用 Chrome 打开', true); return;
  }
  _voiceCancelled = false;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('请允许麦克风权限后重试', true); return; }
  _audioStream = stream;
  const chunks = [];
  const mr = _mediaRecorder = new MediaRecorder(stream);
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    if (_voiceCancelled) return;
    showVoiceProcessing();
    try {
      const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' });
      if (!blob.size) { closeModal(); toast('没录到声音，请再试一次', true); return; }
      const wavB64 = await blobToWav16kBase64(blob);
      const r = await API.post('/voice', { audio: wavB64, format: 'wav', rate: 16000 });
      if (_voiceCancelled) return;
      const txt = (r.text || '').trim();
      if (!txt) { closeModal(); toast('没听清，请再说一次', true); return; }
      // 后端配了 DeepSeek 时返回已解析好的 ops（更智能）；否则回退本地规则解析
      if (Array.isArray(r.ops)) {
        if (r.ops.length) showVoiceConfirm(txt, r.ops);
        else showVoiceNotUnderstood(txt);
      } else {
        handleVoiceResult(txt);
      }
    } catch (e) { closeModal(); toast(e.message || '识别失败，请重试', true); }
  };
  showRecording();
  mr.start();
}

function showRecording() {
  openModal(`
    <h3>🎤 正在录音…</h3>
    <div class="voice-listen"><div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div></div>
    <div class="voice-heard">说出物品和数量，例如「厕纸用掉一包」「买了两瓶酱油」「牛奶还剩三盒」<br>说完点下面「说完了」</div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="vCancel">取消</button>
      <button class="btn" id="vStop">说完了</button>
    </div>`, () => {
    $('#vCancel').onclick = () => { _voiceCancelled = true; try { _mediaRecorder && _mediaRecorder.state !== 'inactive' && _mediaRecorder.stop(); } catch {} if (_audioStream) _audioStream.getTracks().forEach((t) => t.stop()); closeModal(); };
    $('#vStop').onclick = () => { try { _mediaRecorder && _mediaRecorder.state !== 'inactive' && _mediaRecorder.stop(); } catch {} };
  });
}
function showVoiceProcessing() {
  openModal(`<h3>🎤 识别中…</h3><div class="center-load"><span class="spinner"></span></div><div class="voice-heard">正在把语音转成文字</div>`);
}

// webm/opus 录音 → 解码 → 重采样到 16k 单声道 → 编码为 wav → base64
async function blobToWav16kBase64(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const audioBuf = await ctx.decodeAudioData(buf);
  try { ctx.close(); } catch {}
  const input = audioBuf.getChannelData(0);
  const ratio = audioBuf.sampleRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio, i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1);
    let s = input[i0] * (1 - (idx - i0)) + input[i1] * (idx - i0);
    s = Math.max(-1, Math.min(1, s));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const ab = new ArrayBuffer(44 + out.length * 2);
  const v = new DataView(ab);
  const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) v.setInt16(44 + i * 2, out[i], true);
  const bytes = new Uint8Array(ab);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function actionLabel(a) { return a === 'add' ? '增加' : a === 'sub' ? '减少' : '设为'; }

// 本地规则解析（DeepSeek 未配置/出错时的兜底）
function handleVoiceResult(transcript) {
  const ops = parseVoiceCommand(transcript, State.items);
  if (!ops.length) return showVoiceNotUnderstood(transcript);
  showVoiceConfirm(transcript, ops);
}

function showVoiceNotUnderstood(transcript) {
  openModal(`
    <h3>🎤 没太听懂</h3>
    <div class="voice-transcript">“${esc(transcript)}”</div>
    <p style="color:var(--text-soft);font-size:13.5px">没能识别出要改哪样物品、改多少。请确认物品名和应用里一致，换个说法再试，例如「厕纸 用掉 一包」。</p>
    <div class="btn-row"><button class="btn btn-ghost" id="vClose">关闭</button><button class="btn" id="vRetry">再说一次</button></div>
  `, () => { $('#vClose').onclick = closeModal; $('#vRetry').onclick = startVoice; });
}

function showVoiceConfirm(transcript, ops) {
  const rows = ops.map((o, i) => `
    <label class="voice-op">
      <input type="checkbox" data-i="${i}" checked />
      <div class="voice-op-main">
        <div class="voice-op-name">${esc(o.name)} <span class="voice-op-act ${o.action}">${actionLabel(o.action)} ${o.qty}${esc(o.unit)}</span></div>
        <div class="voice-op-num">${o.before}${esc(o.unit)} → <b>${o.after}${esc(o.unit)}</b></div>
      </div>
    </label>`).join('');
  openModal(`
    <h3>🎤 听到的内容</h3>
    <div class="voice-transcript">“${esc(transcript)}”</div>
    <div class="voice-tip">请核对，确认无误再写入：</div>
    ${rows}
    <div class="btn-row"><button class="btn btn-ghost" id="vRetry">重说</button><button class="btn" id="vApply">确认写入</button></div>
  `, () => {
    $('#vRetry').onclick = startVoice;
    $('#vApply').onclick = async () => {
      const picked = [...document.querySelectorAll('.voice-op input:checked')].map((c) => ops[Number(c.dataset.i)]);
      if (!picked.length) return toast('请至少勾选一项', true);
      const btn = $('#vApply'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      let okCount = 0;
      for (const o of picked) {
        try {
          let r;
          if (o.action === 'set') r = await API.put(`/items/${o.itemId}`, { quantity: o.after });
          else r = await API.post(`/items/${o.itemId}/adjust`, { delta: o.action === 'add' ? o.qty : -o.qty });
          const local = State.items.find((x) => x.id === o.itemId);
          if (local) Object.assign(local, r.item);
          okCount++;
        } catch (e) { toast(o.name + '：' + e.message, true); }
      }
      closeModal();
      if (okCount) { toast(`已更新 ${okCount} 项`); renderMain(); }
    };
  });
}

// ---------- 启动 ----------
async function boot() {
  if (!API.token) return renderAuth('login');
  try {
    const me = await API.get('/me');
    State.user = me.user; State.family = me.family;
    await loadData();
    renderMain();
  } catch {
    logout();
  }
}
boot();

// 注册 Service Worker（PWA 可安装到主屏）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
