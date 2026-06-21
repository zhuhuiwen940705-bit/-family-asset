# 🏠 家庭资产管理平台

一个移动端优先的家庭物资库存管理 Web App。解决"家里买的东西不知道还剩多少"的问题——分类记录、随时检索、低库存自动提醒，全家共享一份数据。

安卓手机用浏览器打开即可使用，还能"添加到主屏幕"像原生 App 一样用（PWA），无需上架应用商店。

## ✨ 核心功能

- **家庭单位 + 多成员**：注册即创建家庭（你是管理员）→ 生成 6 位邀请码 → 家人用邀请码加入。管理员可管理成员、设置/取消其他管理员、移除成员、重置邀请码。
- **8 大预设分类**（可自定义增删改）：🥬厨房食材 / 🧂厨房调料消耗 / 🍷酒水饮料 / 🧴日用清洁 / 🧼个护洗护 / 💊药品健康 / 🍼母婴用品 / 📦囤货其他。
- **物品库存**：名称、数量+单位、存放位置、补货阈值、保质期、备注。卡片上 `−/＋` 一键增减数量。
- **智能提醒**：数量 ≤ 阈值自动标"需补货"，保质期临近/过期自动标记，集中在「提醒」页，方便照着列购物清单。
- **强检索**：按物品名、存放位置、备注实时搜索；按分类横向筛选。
- **共享实时**：全家成员看到同一份数据，谁更新的、何时更新都有记录。

## 🚀 快速开始

需要 [Node.js](https://nodejs.org) 18 或更高版本。

```bash
cd family-asset
npm install      # 首次运行，安装依赖（纯 JS，无需编译环境）
npm start        # 启动服务
```

启动后终端会显示访问地址，默认 `http://localhost:3000`。

### 📱 手机访问（同一 WiFi 局域网）

1. 确保手机和电脑连同一个 WiFi。
2. 查看电脑局域网 IP：
   - Windows：PowerShell 运行 `ipconfig`，找 `IPv4 地址`（形如 `192.168.x.x`）。
3. 手机浏览器打开 `http://192.168.x.x:3000`。
4. Chrome 菜单 →「添加到主屏幕」，即可像 App 一样使用。
   > 注：局域网为 http，PWA 安装与离线缓存在部分浏览器需 https；公网部署建议配 https（见下）。

## ☁️ 部署到 Netlify（推荐，真正"在线"+ 免费 https）

本项目已配好 Netlify：静态前端走 CDN，`/api/*` 由一个 Serverless 函数（`netlify/functions/api.js`，内部就是 Express）处理，数据存在 **Netlify Blobs**（Netlify 自带的持久化存储，**无需注册任何外部数据库**，重新部署也不丢数据）。

### 方式一：连 GitHub 自动部署（最省心）

1. 把 `family-asset` 推到一个 GitHub 仓库。
2. Netlify 后台 → **Add new site → Import an existing project** → 选该仓库。
3. 构建设置会自动读取 `netlify.toml`（无需手填）：
   - Publish directory：`public`
   - Functions directory：`netlify/functions`
   - Build command：留空即可（纯静态 + 函数，无需打包前端）
4. 点 **Deploy**。完成后访问分配的 `https://<你的站点>.netlify.app`。

### 方式二：命令行部署

```bash
npm i -g netlify-cli
netlify login
netlify init        # 关联/新建站点
netlify deploy --prod
```

### 本地用 Netlify 环境调试（会真实启用 Blobs）

```bash
netlify dev         # 模拟函数 + Blobs，访问 http://localhost:8888
```

### 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 登录令牌密钥。**不设也行**——首次运行会自动生成并存入 Netlify Blobs 持久化。若想自己固定，在 Netlify 后台 *Site settings → Environment variables* 添加即可。 |

> Netlify Blobs 默认开箱可用。若后台未自动启用，在 *Site configuration → Blobs* 里开启即可。

## 🗂️ 数据与备份

- **Netlify 部署**：数据存在 Netlify Blobs 的 `family-asset` 存储里（键 `db`）。可用 `netlify blobs:get family-asset db` 导出备份。
- **本地运行**：数据存在 `data/db.json`（纯文本 JSON），**复制这个文件即可完整备份**；写入用临时文件 + 原子替换防损坏。
- 两种环境用同一套代码、同一套数据结构，可互相导入导出。

## 🛠️ 技术栈

- 后端：Node.js + Express，通过 `serverless-http` 同时支持「本地常驻进程」和「Netlify 无状态函数」两种运行方式。
- 存储：可插拔——本地用 JSON 文件，Netlify 用 Blobs（见 `lib/store.js`）。
- 认证：bcrypt 密码哈希 + JWT（有效期 60 天），密钥持久化在存储层。
- 前端：原生 JS 单页应用 + PWA（manifest + Service Worker，网络优先缓存，可安装/离线打开）。
- 无需关系型数据库、无需构建工具，开箱即跑。

## 📁 目录结构

```
family-asset/
├── server.js              # 本地运行入口（node server.js）
├── netlify.toml           # Netlify 部署配置（重写规则 / 函数目录）
├── lib/
│   ├── app.js             # Express 应用本体 + 所有 API 路由（本地与 Netlify 共用）
│   └── store.js           # 可插拔存储：本地 JSON 文件 / Netlify Blobs
├── netlify/functions/
│   └── api.js             # Netlify 函数：用 serverless-http 包装 Express
├── package.json
├── data/                  # 本地运行时自动生成：db.json（你的数据）+ .secret
└── public/                # 前端
    ├── index.html
    ├── styles.css         # 移动端优先样式，适配刘海屏安全区
    ├── app.js             # SPA 逻辑：登录/资产/提醒/家庭/我的
    ├── manifest.json      # PWA 配置
    ├── sw.js              # Service Worker
    └── icons/icon.svg # 应用图标
```

## 🔐 安全提示

- 公网部署务必启用 https，并设置一个固定的 `JWT_SECRET`。
- 这是面向家庭的轻量应用：账号体系简单、无邮箱找回。忘记密码可由管理员协助，或直接编辑 `data/db.json`。
