# 聊天参谋 Chat Advisor

对话潜台词分析与回复建议工具。为聊天对象建档（性格/背景/爱好），手动输入双方对话，AI 分析隐藏含义并建议下一步怎么回。支持账户登录、多端数据同步、按账户隔离。

## 功能
- 聊天对象档案管理（性格、背景、爱好、备注）
- 对话记录（支持指定每句话发生时间，时间线展示）
- AI 分析：潜台词解读、情绪状态、对方意图、回应雷区、策略化回复建议
- 选中单句单独分析；「我的想法」求助模式（可锚定时间点，以当时对话为背景求解）
- 账户系统：注册/登录，数据云端同步，多端可见同一份，账户间数据隔离
- AI 服务的 API Key 仅存本地浏览器，不上传服务器

## 部署到 Render（一键）
点下面的按钮，授权后自动部署，1-2 分钟得到公网网址：

[![Deploy to Render](https://render.com/images/deploy-to-render-btn.svg)](https://render.com/deploy?repo=https://github.com/whosme2026/chat-advisor)

## ⚠️ 重要：配置数据持久化（否则每次部署/更新账号数据会丢失！）
Render 免费层的文件系统是临时的，每次部署/重启 data/ 目录会被清空。必须配一个外部数据库，数据才能持久保留。

推荐用 **Neon**（免费 PostgreSQL，永久免费 0.5GB，注册简单）：

1. 注册 Neon（免费）：https://neon.tech （可用 GitHub/Google 账号登录）
2. 新建一个项目（默认即可），会得到一个连接字符串，形如：
   `postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`
3. 回到 Render，打开你的 chat-advisor 服务 → **Environment** 标签 → 新增环境变量：
   - Key：`DATABASE_URL`
   - Value：上面 Neon 的连接字符串
4. （同时确认已有 `JWT_SECRET`，没有就加一个随机字符串）
5. 保存后 Render 自动重新部署。之后无论怎么更新代码、重新部署，账号和数据都不会丢

> 不配 DATABASE_URL 也能跑，但仅限本机开发用；部署到云端后每次更新都会丢账号。

部署完成后：
1. 打开 Render 给的公网网址
2. 注册一个账号
3. 在「⚙️ 设置」里填入你的 AI API（如 DeepSeek：地址 `https://api.deepseek.com`，模型 `deepseek-chat`，Key 填你自己的）
4. 开始使用。手机/电脑登录同账号，数据自动同步

## 本机运行
```bash
npm install
node server.js
```
浏览器打开 http://localhost:8000 （本机默认用 JSON 文件存储，无需数据库）

## 技术栈
- 前端：单文件 HTML + CSS + JS
- 后端：Node.js + Express + JWT
- 存储：PostgreSQL（Neon，云端持久）/ JSON 文件（本机回退），按用户隔离
- AI：兼容 OpenAI 格式的任意接口（DeepSeek/OpenAI/智谱等）
