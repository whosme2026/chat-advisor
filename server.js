/*
  聊天参谋 Chat Advisor - 后端服务
  存储：配了 DATABASE_URL 环境变量 → 用 PostgreSQL（推荐，数据持久，部署不丢）
        没配 → 用 JSON 文件（仅本机开发用，云端部署会丢数据）
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

/* ===== 数据库（PostgreSQL，可选；配了 DATABASE_URL 才启用）===== */
let pool = null;
if (process.env.DATABASE_URL) {
  let pg;
  try { pg = require('pg'); } catch (e) { console.error('缺少 pg 依赖，请运行 npm install pg'); process.exit(1); }
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pwd TEXT NOT NULL, created_at BIGINT);
        CREATE TABLE IF NOT EXISTS user_data (user_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at BIGINT);
      `);
      console.log('✅ 数据库表就绪（PostgreSQL 持久存储）');
    } catch (e) { console.error('建表失败:', e.message); }
  })();
} else {
  console.log('⚠️ 未配置 DATABASE_URL，使用 JSON 文件存储（仅本机开发；云端部署会丢数据，请配置 DATABASE_URL）');
}

/* ===== 密码哈希：scrypt + 随机 salt ===== */
function hashPwd(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + '$' + crypto.scryptSync(pwd, salt, 64).toString('hex');
}
function verifyPwd(pwd, stored) {
  const [salt, hash] = stored.split('$');
  return crypto.scryptSync(pwd, salt, 64).toString('hex') === hash;
}

/* ===== JSON 文件存储（本机回退）===== */
function jUsers() { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')); } catch { return {}; } }
function jSaveUsers(u) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(u, null, 2)); }
function jUserData(id) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, id + '.json'), 'utf8')); } catch { return { characters: [], conversations: [] }; } }
function jSaveUserData(id, d) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, id + '.json'), JSON.stringify(d, null, 2)); }

/* ===== 统一存储层（PG / JSON 自动切换）===== */
const DB = {
  async findUser(username) {
    if (pool) {
      const r = await pool.query('SELECT id, username, pwd FROM users WHERE username=$1', [username]);
      return r.rows[0] || null;
    }
    const u = jUsers()[username];
    return u ? { id: u.id, username, pwd: u.pwd } : null;
  },
  async createUser(username, hpwd) {
    const id = crypto.randomUUID();
    if (pool) {
      await pool.query('INSERT INTO users(id, username, pwd, created_at) VALUES($1,$2,$3,$4)', [id, username, hpwd, Date.now()]);
    } else {
      const u = jUsers(); u[username] = { id, pwd: hpwd, createdAt: Date.now() }; jSaveUsers(u);
    }
    return { id, username };
  },
  async getUserData(userId) {
    if (pool) {
      const r = await pool.query('SELECT data FROM user_data WHERE user_id=$1', [userId]);
      return r.rows[0] ? r.rows[0].data : { characters: [], conversations: [] };
    }
    return jUserData(userId);
  },
  async saveUserData(userId, data) {
    if (pool) {
      await pool.query('INSERT INTO user_data(user_id, data, updated_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET data=$2, updated_at=$3', [userId, JSON.stringify(data), Date.now()]);
    } else {
      jSaveUserData(userId, data);
    }
  },
};

/* ===== 中间件 ===== */
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.url}`); next(); });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: '登录已过期，请重新登录' }); }
}

/* ===== 路由 ===== */
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.trim().length < 2) return res.status(400).json({ error: '用户名至少 2 个字符' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  try {
    if (await DB.findUser(username)) return res.status(409).json({ error: '该用户名已被注册' });
    const user = await DB.createUser(username, hashPwd(password));
    await DB.saveUserData(user.id, { characters: [], conversations: [] });
    const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (e) { console.error('注册失败:', e); res.status(500).json({ error: '服务器错误: ' + e.message }); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const u = await DB.findUser(username);
    if (!u || !verifyPwd(password, u.pwd)) return res.status(401).json({ error: '用户名或密码错误' });
    const token = jwt.sign({ id: u.id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, username } });
  } catch (e) { console.error('登录失败:', e); res.status(500).json({ error: '服务器错误: ' + e.message }); }
});

app.get('/api/data', auth, async (req, res) => {
  try { res.json(await DB.getUserData(req.user.id)); }
  catch (e) { console.error('取数据失败:', e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/data', auth, async (req, res) => {
  const { characters, conversations } = req.body;
  if (!Array.isArray(characters) || !Array.isArray(conversations)) return res.status(400).json({ error: '数据格式错误' });
  try {
    await DB.saveUserData(req.user.id, { characters, conversations });
    res.json({ ok: true, savedAt: Date.now() });
  } catch (e) { console.error('存数据失败:', e); res.status(500).json({ error: '服务器错误' }); }
});

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, db: !!pool }));

// 静态托管前端
app.use(express.static(__dirname, { index: 'index.html' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  聊天参谋后端已启动');
  console.log('  端口: ' + PORT);
  console.log('  存储: ' + (pool ? 'PostgreSQL（持久）' : 'JSON 文件（临时，仅本机）'));
  console.log('  本机: http://localhost:' + PORT);
  console.log('========================================');
});
