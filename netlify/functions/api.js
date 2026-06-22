'use strict';
// Netlify Function：用 serverless-http 包装 Express 应用，处理所有 /api/*。
// 用 Netlify Blobs 持久化（数据就在这个站点的 Blobs 里）。
process.env.USE_BLOBS = '1';

const serverless = require('serverless-http');
const app = require('../../lib/app');
const handler = serverless(app);

exports.handler = async (event, context) => {
  let p = event.path || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : '/' + p);
  event.path = p;
  return handler(event, context);
};
