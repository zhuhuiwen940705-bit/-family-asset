'use strict';
// 本地运行入口：node server.js（用 data/db.json 文件存储）。
const path = require('path');
const app = require('./lib/app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n  🏠 家庭资产管理平台已启动`);
  console.log(`  本机访问:   http://localhost:${PORT}`);
  console.log(`  手机访问:   http://<本机局域网IP>:${PORT}  (手机与电脑连同一WiFi)`);
  console.log(`  数据文件:   ${path.join(__dirname, 'data', 'db.json')}\n`);
});
