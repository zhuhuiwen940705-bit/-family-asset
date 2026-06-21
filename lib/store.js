'use strict';
/**
 * 可插拔数据存储层。
 *  - 本地运行（node server.js）：用 data/db.json 文件（零依赖、可备份）。
 *  - Netlify 部署（USE_BLOBS=1）：用 Netlify Blobs，函数无状态、文件系统只读也能持久化。
 *
 * 关键：Serverless 每次调用都是全新进程，所以每个请求开始时 loadData() 从存储拉取，
 * 路由改完数据后 await save() 写回。data 对象「身份保持不变」，只替换其内部数组，
 * 这样 require 时解构出来的 data 引用始终有效。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USE_BLOBS = process.env.USE_BLOBS === '1';

// ---- 内存中的当前数据（身份稳定，内容按请求刷新）----
const data = { families: [], users: [], categories: [], items: [] };
function emptyData() { return { families: [], users: [], categories: [], items: [] }; }

// ============ 本地文件存储 ============
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');

const FileStore = {
  async loadAll() {
    try {
      if (!fs.existsSync(DATA_FILE)) return emptyData();
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return { families: d.families || [], users: d.users || [], categories: d.categories || [], items: d.items || [] };
    } catch (e) {
      console.error('数据文件损坏，已备份并重置：', e.message);
      try { fs.renameSync(DATA_FILE, DATA_FILE + '.broken.' + Date.now()); } catch {}
      return emptyData();
    }
  },
  async saveAll(d) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, DATA_FILE);
  },
  async getSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
    const s = crypto.randomBytes(48).toString('hex');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s);
    return s;
  },
};

// ============ Netlify Blobs 存储 ============
// @netlify/blobs 是 ESM 包，CommonJS 里用动态 import 引入并缓存。
let _blobMod = null;
async function blobStore() {
  if (!_blobMod) _blobMod = await import('@netlify/blobs');
  const opts = { name: 'family-asset', consistency: 'strong' };
  // 部署到 Netlify 后，运行时会自动注入 Blobs 上下文，无需任何配置。
  // 下面是显式凭据回退：本地 netlify dev 未登录、或想手动指定时，
  // 设置环境变量 NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN（个人访问令牌）即可启用。
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return _blobMod.getStore(opts);
}
const BlobStore = {
  async loadAll() {
    const s = await blobStore();
    const d = await s.get('db', { type: 'json' });
    if (!d) return emptyData();
    return { families: d.families || [], users: d.users || [], categories: d.categories || [], items: d.items || [] };
  },
  async saveAll(d) {
    const s = await blobStore();
    await s.setJSON('db', d);
  },
  async getSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const s = await blobStore();
    let sec = await s.get('jwt-secret', { type: 'text' });
    if (!sec) { sec = crypto.randomBytes(48).toString('hex'); await s.set('jwt-secret', sec); }
    return sec;
  },
};

const backend = USE_BLOBS ? BlobStore : FileStore;

// ---- 对外接口 ----
async function loadData() {
  const fresh = await backend.loadAll();
  data.families = fresh.families;
  data.users = fresh.users;
  data.categories = fresh.categories;
  data.items = fresh.items;
}
async function save() { await backend.saveAll(data); }

let _secretCache = null;
async function getSecret() {
  if (_secretCache) return _secretCache;
  _secretCache = await backend.getSecret();
  return _secretCache;
}

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

// 默认分类（中国家庭习惯）
const DEFAULT_CATEGORIES = [
  { name: '厨房食材', icon: '🥬' },
  { name: '厨房调料消耗', icon: '🧂' },
  { name: '酒水饮料', icon: '🍷' },
  { name: '日用清洁', icon: '🧴' },
  { name: '个护洗护', icon: '🧼' },
  { name: '药品健康', icon: '💊' },
  { name: '母婴用品', icon: '🍼' },
  { name: '囤货其他', icon: '📦' },
];
function seedCategories(familyId) {
  DEFAULT_CATEGORIES.forEach((c, i) => {
    data.categories.push({ id: id(), familyId, name: c.name, icon: c.icon, sortOrder: i });
  });
}

// 生成 6 位易读邀请码（去掉易混字符）
function genInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  } while (data.families.some((f) => f.inviteCode === code));
  return code;
}

module.exports = {
  data, loadData, save, getSecret,
  id, now, seedCategories, genInviteCode,
  DEFAULT_CATEGORIES, USE_BLOBS,
};
