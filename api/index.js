'use strict';
// Vercel Serverless Function 入口：直接复用 Express 应用（Vercel 的 (req,res) 即 Express handler）。
// vercel.json 把所有 /api/* 重写到这里。
module.exports = require('../lib/app');
