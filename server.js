/*
  聊天参谋 Chat Advisor - 后端服务
  功能：用户注册/登录（JWT）、按用户隔离的数据存储（JSON 文件）、多端同步
  启动：node server.js  (默认端口 8000，可用 PORT 环境变量覆盖)
*/
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;
// JWT 密钥：优先用环境变量（部署时固定），否则每次启动随机（重启后旧 token 失效）
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

// 密码哈希：scrypt + 随机 salt
function hashPwd(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return salt + '$' + hash;
}
function verifyPwd(pwd, stored) {
  const [salt, hash] = stored.split('$');
  const h = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return h === hash;
}

// 允许所有来源跨域（前端可能部署在不同域名）
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// 简单日志
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// 认证中间件
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.trim().length < 2) return res.status(400).json({ error: '用户名至少 2 个字符' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  const users = loadUsers();
  if (users[username]) return res.status(409).json({ error: '该用户名已被注册' });
  const id = crypto.randomUUID();
  users[username] = { id, pwd: hashPwd(password), createdAt: Date.now() };
  saveUsers(users);
  fs.writeFileSync(path.join(DATA_DIR, id + '.json'), JSON.stringify({ characters: [], conversations: [] }, null, 2));
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, username } });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const u = users[username];
  if (!u || !verifyPwd(password, u.pwd)) return res.status(401).json({ error: '用户名或密码错误' });
  const token = jwt.sign({ id: u.id, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, username } });
});

// 拉取当前用户的全部数据
app.get('/api/data', auth, (req, res) => {
  const file = path.join(DATA_DIR, req.user.id + '.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(data);
  } catch {
    res.json({ characters: [], conversations: [] });
  }
});

// 保存当前用户的全部数据（整体覆盖，简单可靠）
app.put('/api/data', auth, (req, res) => {
  const { characters, conversations } = req.body;
  if (!Array.isArray(characters) || !Array.isArray(conversations)) {
    return res.status(400).json({ error: '数据格式错误' });
  }
  const file = path.join(DATA_DIR, req.user.id + '.json');
  fs.writeFileSync(file, JSON.stringify({ characters, conversations }, null, 2));
  res.json({ ok: true, savedAt: Date.now() });
});

// 静态托管前端（本机或单机部署时用得到）
app.use(express.static(__dirname, { index: 'index.html' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  聊天参谋后端已启动');
  console.log('  本机:   http://localhost:' + PORT);
  console.log('  局域网: http://本机IP:' + PORT);
  console.log('  数据目录: ' + DATA_DIR);
  console.log('========================================');
});
