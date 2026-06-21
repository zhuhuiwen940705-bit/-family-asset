'use strict';
// Netlify Function：把整个 Express 应用包成一个无状态函数，处理所有 /api/* 请求。
// 用 Netlify Blobs 做持久化存储。
process.env.USE_BLOBS = '1';

const serverless = require('serverless-http');
const app = require('../../lib/app');
const handler = serverless(app);

exports.handler = async (event, context) => {
  // 兼容两种到达路径：经 redirect 改写的 /api/xxx，或直连 /.netlify/functions/api/xxx，
  // 统一规整成 Express 路由所用的 /api/xxx。
  let p = event.path || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : '/' + p);
  event.path = p;
  return handler(event, context);
};
