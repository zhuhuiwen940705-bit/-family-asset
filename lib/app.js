'use strict';
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');

const app = express();
const { data, save, id, now } = store;

let SECRET = null; // 首次请求时从存储加载并缓存

app.use(express.json({ limit: '1mb' }));
// 本地运行时直接由 Express 托管前端；Netlify 上静态资源走 CDN，不会进到这里。
app.use(express.static(path.join(__dirname, '..', 'public')));

// 诊断接口（不经过下面的存储加载中间件），用于排查存储/Blobs 是否就绪
app.get('/api/_diag', async (req, res) => {
  const siteId = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || '';
  const env = {
    node: process.version,
    USE_BLOBS: process.env.USE_BLOBS || null,
    hasBlobsContext: !!process.env.NETLIFY_BLOBS_CONTEXT,
    siteIdSource: process.env.NETLIFY_SITE_ID ? 'NETLIFY_SITE_ID' : (process.env.SITE_ID ? 'SITE_ID(自动)' : '无'),
    siteIdValue: siteId ? (siteId.slice(0, 8) + '…长度' + siteId.length) : '',
    hasToken: !!(process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN),
    netlify: process.env.NETLIFY || null,
  };
  let storage = 'untested';
  try { await store.loadData(); storage = 'OK（读取成功，共 ' + store.data.users.length + ' 用户）'; }
  catch (e) { storage = (e && e.name) + ': ' + (e && e.message); }
  res.json({ env, storage });
});

// 每个 /api 请求开始：从存储拉取最新数据 + 确保密钥就绪
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api') || req.path === '/api/_diag') return next();
  try {
    await store.loadData();
    if (!SECRET) SECRET = await store.getSecret();
    next();
  } catch (e) {
    console.error('加载数据失败:', e);
    res.status(500).json({ error: '服务暂时不可用，请稍后再试', detail: (e && e.name) + ': ' + (e && e.message) });
  }
});

// ---------- 工具 ----------
function sign(user) {
  return jwt.sign({ uid: user.id, fid: user.familyId }, SECRET, { expiresIn: '60d' });
}
function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, familyId: u.familyId, createdAt: u.createdAt };
}
function ok(res, payload) { res.json(payload); }
function err(res, code, msg) { res.status(code).json({ error: msg }); }

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return err(res, 401, '未登录');
  try {
    const p = jwt.verify(token, SECRET);
    const user = data.users.find((u) => u.id === p.uid);
    if (!user) return err(res, 401, '用户不存在');
    req.user = user;
    next();
  } catch {
    return err(res, 401, '登录已过期，请重新登录');
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return err(res, 403, '仅管理员可操作');
  next();
}

// ---------- 认证 ----------
app.post('/api/register', async (req, res) => {
  const { username, password, displayName, familyName } = req.body || {};
  if (!username || !password || !familyName) return err(res, 400, '请填写用户名、密码和家庭名称');
  if (String(username).length < 3) return err(res, 400, '用户名至少 3 个字符');
  if (String(password).length < 6) return err(res, 400, '密码至少 6 个字符');
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return err(res, 409, '用户名已被占用');

  const family = { id: id(), name: familyName.trim(), inviteCode: store.genInviteCode(), createdAt: now() };
  data.families.push(family);
  store.seedCategories(family.id);

  const user = {
    id: id(), familyId: family.id, username: username.trim(),
    displayName: (displayName || username).trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'admin', createdAt: now(),
  };
  data.users.push(user);
  await save();
  ok(res, { token: sign(user), user: publicUser(user), family });
});

app.post('/api/join', async (req, res) => {
  const { username, password, displayName, inviteCode } = req.body || {};
  if (!username || !password || !inviteCode) return err(res, 400, '请填写用户名、密码和邀请码');
  if (String(password).length < 6) return err(res, 400, '密码至少 6 个字符');
  const family = data.families.find((f) => f.inviteCode === String(inviteCode).toUpperCase().trim());
  if (!family) return err(res, 404, '邀请码无效');
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return err(res, 409, '用户名已被占用');

  const user = {
    id: id(), familyId: family.id, username: username.trim(),
    displayName: (displayName || username).trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'member', createdAt: now(),
  };
  data.users.push(user);
  await save();
  ok(res, { token: sign(user), user: publicUser(user), family });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = data.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash))
    return err(res, 401, '用户名或密码错误');
  const family = data.families.find((f) => f.id === user.familyId);
  ok(res, { token: sign(user), user: publicUser(user), family });
});

app.get('/api/me', auth, (req, res) => {
  const family = data.families.find((f) => f.id === req.user.familyId);
  ok(res, { user: publicUser(req.user), family });
});

app.post('/api/me/password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!bcrypt.compareSync(oldPassword || '', req.user.passwordHash)) return err(res, 400, '原密码错误');
  if (String(newPassword || '').length < 6) return err(res, 400, '新密码至少 6 个字符');
  req.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  await save();
  ok(res, { success: true });
});

app.post('/api/me/profile', auth, async (req, res) => {
  const { displayName } = req.body || {};
  if (displayName && displayName.trim()) req.user.displayName = displayName.trim();
  await save();
  ok(res, { user: publicUser(req.user) });
});

// ---------- 家庭与成员 ----------
app.get('/api/family', auth, (req, res) => {
  const family = data.families.find((f) => f.id === req.user.familyId);
  const members = data.users
    .filter((u) => u.familyId === req.user.familyId)
    .map(publicUser)
    .sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === 'admin' ? -1 : 1));
  ok(res, { family, members });
});

app.post('/api/family/reset-invite', auth, adminOnly, async (req, res) => {
  const family = data.families.find((f) => f.id === req.user.familyId);
  family.inviteCode = store.genInviteCode();
  await save();
  ok(res, { family });
});

app.post('/api/family/rename', auth, adminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return err(res, 400, '家庭名不能为空');
  const family = data.families.find((f) => f.id === req.user.familyId);
  family.name = name.trim();
  await save();
  ok(res, { family });
});

app.delete('/api/family/members/:uid', auth, adminOnly, async (req, res) => {
  const target = data.users.find((u) => u.id === req.params.uid && u.familyId === req.user.familyId);
  if (!target) return err(res, 404, '成员不存在');
  if (target.id === req.user.id) return err(res, 400, '不能移除自己');
  data.users = data.users.filter((u) => u.id !== target.id);
  await save();
  ok(res, { success: true });
});

app.post('/api/family/members/:uid/role', auth, adminOnly, async (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'member'].includes(role)) return err(res, 400, '角色无效');
  const target = data.users.find((u) => u.id === req.params.uid && u.familyId === req.user.familyId);
  if (!target) return err(res, 404, '成员不存在');
  if (target.id === req.user.id && role === 'member') {
    const adminCount = data.users.filter((u) => u.familyId === req.user.familyId && u.role === 'admin').length;
    if (adminCount <= 1) return err(res, 400, '至少需保留一名管理员');
  }
  target.role = role;
  await save();
  ok(res, { user: publicUser(target) });
});

// ---------- 分类 ----------
app.get('/api/categories', auth, (req, res) => {
  const cats = data.categories
    .filter((c) => c.familyId === req.user.familyId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  ok(res, { categories: cats });
});

app.post('/api/categories', auth, async (req, res) => {
  const { name, icon } = req.body || {};
  if (!name || !name.trim()) return err(res, 400, '分类名不能为空');
  const maxSort = data.categories
    .filter((c) => c.familyId === req.user.familyId)
    .reduce((m, c) => Math.max(m, c.sortOrder), -1);
  const cat = { id: id(), familyId: req.user.familyId, name: name.trim(), icon: (icon || '📦').trim(), sortOrder: maxSort + 1 };
  data.categories.push(cat);
  await save();
  ok(res, { category: cat });
});

app.put('/api/categories/:cid', auth, async (req, res) => {
  const cat = data.categories.find((c) => c.id === req.params.cid && c.familyId === req.user.familyId);
  if (!cat) return err(res, 404, '分类不存在');
  const { name, icon } = req.body || {};
  if (name && name.trim()) cat.name = name.trim();
  if (icon && icon.trim()) cat.icon = icon.trim();
  await save();
  ok(res, { category: cat });
});

app.delete('/api/categories/:cid', auth, async (req, res) => {
  const cat = data.categories.find((c) => c.id === req.params.cid && c.familyId === req.user.familyId);
  if (!cat) return err(res, 404, '分类不存在');
  const count = data.items.filter((i) => i.categoryId === cat.id).length;
  if (count > 0) return err(res, 400, `该分类下还有 ${count} 件物品，请先移除或转移`);
  data.categories = data.categories.filter((c) => c.id !== cat.id);
  await save();
  ok(res, { success: true });
});

// ---------- 物品 ----------
function itemView(it) {
  const u = data.users.find((x) => x.id === it.updatedBy);
  return { ...it, updatedByName: u ? u.displayName : '—' };
}

// 自动消耗：按周期惰性扣减。每次有人打开应用读取列表时，把已过去的周期一次性补扣，
// 无需后台定时任务（适合 Serverless）。
const PERIOD_MS = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
function accrueAutoConsume(items) {
  let changed = false;
  const nowMs = Date.now();
  for (const it of items) {
    const amt = Number(it.autoConsume) || 0;
    const pms = PERIOD_MS[it.consumePeriod];
    if (amt <= 0 || !pms) continue;
    const last = Date.parse(it.lastConsumedAt || it.createdAt);
    if (isNaN(last)) { it.lastConsumedAt = new Date(nowMs).toISOString(); changed = true; continue; }
    const periods = Math.floor((nowMs - last) / pms);
    if (periods < 1) continue;
    const dec = Math.min(it.quantity, periods * amt);
    if (dec > 0) it.quantity = Math.max(0, it.quantity - dec);
    it.lastConsumedAt = new Date(last + periods * pms).toISOString(); // 推进时钟，避免补货后一次性扣回欠账
    changed = true;
  }
  return changed;
}

app.get('/api/items', auth, async (req, res) => {
  const mine = data.items.filter((i) => i.familyId === req.user.familyId);
  if (accrueAutoConsume(mine)) await save();
  const items = mine
    .map(itemView)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  ok(res, { items });
});

app.post('/api/items', auth, async (req, res) => {
  const { name, categoryId, quantity, unit, location, threshold, expiry, note, autoConsume, consumePeriod } = req.body || {};
  if (!name || !name.trim()) return err(res, 400, '物品名称不能为空');
  if (!data.categories.some((c) => c.id === categoryId && c.familyId === req.user.familyId))
    return err(res, 400, '请选择有效分类');
  const period = PERIOD_MS[consumePeriod] ? consumePeriod : '';
  const item = {
    id: id(), familyId: req.user.familyId, categoryId,
    name: name.trim(),
    quantity: Number(quantity) || 0,
    unit: (unit || '件').trim(),
    location: (location || '').trim(),
    threshold: Number(threshold) || 0,
    expiry: expiry || '',
    note: (note || '').trim(),
    autoConsume: Math.max(0, Number(autoConsume) || 0),
    consumePeriod: period,
    lastConsumedAt: now(),
    updatedBy: req.user.id, updatedAt: now(), createdAt: now(),
  };
  data.items.push(item);
  await save();
  ok(res, { item: itemView(item) });
});

app.put('/api/items/:iid', auth, async (req, res) => {
  const item = data.items.find((i) => i.id === req.params.iid && i.familyId === req.user.familyId);
  if (!item) return err(res, 404, '物品不存在');
  const b = req.body || {};
  if (b.name !== undefined) item.name = String(b.name).trim() || item.name;
  if (b.categoryId !== undefined && data.categories.some((c) => c.id === b.categoryId && c.familyId === req.user.familyId)) item.categoryId = b.categoryId;
  if (b.quantity !== undefined) item.quantity = Math.max(0, Number(b.quantity) || 0);
  if (b.unit !== undefined) item.unit = String(b.unit).trim() || item.unit;
  if (b.location !== undefined) item.location = String(b.location).trim();
  if (b.threshold !== undefined) item.threshold = Math.max(0, Number(b.threshold) || 0);
  if (b.expiry !== undefined) item.expiry = b.expiry || '';
  if (b.note !== undefined) item.note = String(b.note).trim();
  if (b.autoConsume !== undefined) item.autoConsume = Math.max(0, Number(b.autoConsume) || 0);
  if (b.consumePeriod !== undefined) item.consumePeriod = PERIOD_MS[b.consumePeriod] ? b.consumePeriod : '';
  // 编辑了数量或消耗设置 → 重置消耗计时起点（从此刻重新计）
  if (b.quantity !== undefined || b.autoConsume !== undefined || b.consumePeriod !== undefined) item.lastConsumedAt = now();
  item.updatedBy = req.user.id;
  item.updatedAt = now();
  await save();
  ok(res, { item: itemView(item) });
});

app.post('/api/items/:iid/adjust', auth, async (req, res) => {
  const item = data.items.find((i) => i.id === req.params.iid && i.familyId === req.user.familyId);
  if (!item) return err(res, 404, '物品不存在');
  const delta = Number(req.body?.delta) || 0;
  item.quantity = Math.max(0, item.quantity + delta);
  item.updatedBy = req.user.id;
  item.updatedAt = now();
  await save();
  ok(res, { item: itemView(item) });
});

app.delete('/api/items/:iid', auth, async (req, res) => {
  const item = data.items.find((i) => i.id === req.params.iid && i.familyId === req.user.familyId);
  if (!item) return err(res, 404, '物品不存在');
  data.items = data.items.filter((i) => i.id !== item.id);
  await save();
  ok(res, { success: true });
});

// ---------- 语音识别（百度语音 REST）----------
// 用 DeepSeek 大模型把口语解析成结构化库存操作（更智能、可纠同音字）。
// 未配置 DEEPSEEK_API_KEY 或出错时返回 null，前端回退到本地规则解析。
async function llmParse(transcript, items) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !transcript) return null;
  const list = items.map((it) => `${it.id} | ${it.name} | ${it.quantity}${it.unit}`).join('\n');
  const sys = '你是家庭库存语音助手。根据用户口语和现有物品清单，判断要执行的库存操作。规则：'
    + '1) 只能操作清单中已存在的物品，按读音和含义匹配（用户可能有同音字、错别字或口语化表达，如"厕纸/测纸"应对应清单里的"厕纸"）；'
    + '2) action 取值：add=买入/增加，sub=用掉/减少，set=还剩/设为某个值；'
    + '3) qty 为数字（中文数字也要转成阿拉伯数字）；'
    + '4) 一句话可能含多个操作；实在匹配不到物品或数量就忽略该条。'
    + '只输出 JSON：{"ops":[{"id":"物品id","action":"add|sub|set","qty":数字}]}，无可执行操作则 {"ops":[]}。';
  const user = `用户说：「${transcript}」\n现有物品(id | 名称 | 当前库存)：\n${list || '(无)'}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  let content;
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat', temperature: 0, max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  } finally { clearTimeout(timer); }
  if (!content) return null;
  let parsed;
  try { parsed = JSON.parse(content); } catch { return null; }
  const raw = Array.isArray(parsed.ops) ? parsed.ops : [];
  const ops = [];
  for (const o of raw) {
    const it = items.find((x) => x.id === o.id);
    const qty = Number(o.qty);
    if (!it || !isFinite(qty) || !['add', 'sub', 'set'].includes(o.action)) continue;
    const before = it.quantity;
    const after = o.action === 'add' ? before + qty : o.action === 'sub' ? Math.max(0, before - qty) : Math.max(0, qty);
    ops.push({ itemId: it.id, name: it.name, unit: it.unit, action: o.action, qty, before, after });
  }
  return ops;
}

// 讯飞语音听写：返回浏览器直连用的签名 wss 地址（音频不经此服务器）。
app.get('/api/iflytek-url', auth, (req, res) => {
  const crypto = require('crypto');
  const appId = process.env.XFYUN_APP_ID, apiKey = process.env.XFYUN_API_KEY, apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) return err(res, 400, '服务端未配置讯飞密钥（XFYUN_APP_ID / XFYUN_API_KEY / XFYUN_API_SECRET）');
  const host = 'iat-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authOrigin).toString('base64');
  const url = `wss://${host}/v2/iat?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;
  ok(res, { url, appId });
});

// 文字直接解析（用 DeepSeek）。用于校验大模型理解，也可作为"打字录入"入口。
app.post('/api/parse', auth, async (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return err(res, 400, '缺少文本');
  if (!process.env.DEEPSEEK_API_KEY) return err(res, 400, '未配置 DEEPSEEK_API_KEY');
  const ops = await llmParse(text, data.items.filter((i) => i.familyId === req.user.familyId));
  ok(res, { text, ops: ops || [] });
});

// API 未命中
app.use('/api', (req, res) => err(res, 404, '接口不存在'));

// 本地 SPA 兜底（Netlify 上由 netlify.toml 的 redirects 处理）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
