'use strict';
/**
 * 可插拔数据存储层。
 *  - 本地运行（node server.js）：用 data/db.json 文件。
 *  - 线上（Vercel）：用 Upstash Redis（REST API，通过环境变量配置）。
 *
 * Serverless 每次调用都是全新进程，所以每个请求开始时 loadData() 拉取，改完 await save() 写回。
 * data 对象「身份保持不变」，只替换其内部数组，这样 require 时解构出来的 data 引用始终有效。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 后端选择：USE_BLOBS=1 → Netlify Blobs；否则有 Redis 环境变量 → Upstash Redis；否则本地文件。
const USE_BLOBS = process.env.USE_BLOBS === '1';
// Upstash / Vercel KV 的环境变量（任一组都支持）
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const data = { families: [], users: [], categories: [], items: [] };
function emptyData() { return { families: [], users: [], categories: [], items: [] }; }
function normalize(d) {
  return { families: d.families || [], users: d.users || [], categories: d.categories || [], items: d.items || [] };
}

// ============ 本地文件存储 ============
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const FileStore = {
  async loadAll() {
    try {
      if (!fs.existsSync(DATA_FILE)) return emptyData();
      return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
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

// ============ Upstash Redis 存储（REST 命令 API）============
async function redisCmd(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error('Redis 错误：' + j.error);
  return j.result;
}
const RedisStore = {
  async loadAll() {
    const v = await redisCmd(['GET', 'db']);
    if (!v) return emptyData();
    try { return normalize(typeof v === 'string' ? JSON.parse(v) : v); } catch { return emptyData(); }
  },
  async saveAll(d) {
    await redisCmd(['SET', 'db', JSON.stringify(d)]);
  },
  async getSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const v = await redisCmd(['GET', 'jwt-secret']);
    if (v) return typeof v === 'string' ? v : String(v);
    const s = crypto.randomBytes(48).toString('hex');
    await redisCmd(['SET', 'jwt-secret', s]);
    return s;
  },
};

// ============ Netlify Blobs 存储（@netlify/blobs，ESM，动态 import）============
let _blobMod = null;
async function blobStore() {
  if (!_blobMod) _blobMod = await import('@netlify/blobs');
  const opts = { name: 'family-asset', consistency: 'strong' };
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return _blobMod.getStore(opts);
}
const BlobStore = {
  async loadAll() {
    const s = await blobStore();
    const d = await s.get('db', { type: 'json' });
    return d ? normalize(d) : emptyData();
  },
  async saveAll(d) { const s = await blobStore(); await s.setJSON('db', d); },
  async getSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const s = await blobStore();
    let sec = await s.get('jwt-secret', { type: 'text' });
    if (!sec) { sec = crypto.randomBytes(48).toString('hex'); await s.set('jwt-secret', sec); }
    return sec;
  },
};

const backend = USE_BLOBS ? BlobStore : (USE_REDIS ? RedisStore : FileStore);

async function loadData() {
  const fresh = await backend.loadAll();
  data.families = fresh.families;
  data.users = fresh.users;
  data.categories = fresh.categories;
  data.items = fresh.items;
}
async function save() { await backend.saveAll(data); }

let _secretCache = process.env.JWT_SECRET || null;
async function getSecret() {
  if (_secretCache) return _secretCache;
  _secretCache = await backend.getSecret();
  return _secretCache;
}

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

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
  DEFAULT_CATEGORIES, USE_REDIS,
};
