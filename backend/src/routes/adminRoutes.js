// backend/src/routes/adminRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../tmp') });

function requireAdmin(req, res, next) {
 const token = req.headers['x-admin-token'];
 if (!token || token !== process.env.ADMIN_TOKEN) {
  return res.status(403).json({ error: 'forbidden' });
 }
 next();
}

const EMP_PATH = path.join(__dirname, '../data/employees.json');
const VISION_KEY_PATH = path.join(__dirname, '../creds/vision.json');
const ENV_PATH = path.join(process.cwd(), '.env');

// 유틸: 원자적 파일 쓰기
function atomicWrite(filePath, content) {
 const dir = path.dirname(filePath);
 const tmp = path.join(dir, `.__tmp_${Date.now()}`);
 fs.writeFileSync(tmp, content, 'utf-8');
 fs.renameSync(tmp, filePath);
}

// 이름 정리
function sanitizeList(raw) {
 return raw
  .map(n => (n || '').trim())
  .filter(n => n.length > 0)
  .filter((n, i, arr) => arr.indexOf(n) === i); // 중복 제거
}

// 1) 직원 목록 조회
router.get('/employees', requireAdmin, (req, res) => {
 if (!fs.existsSync(EMP_PATH)) {
  return res.json({ day_shift: [], night_shift: [] });
 }
 try {
  const data = JSON.parse(fs.readFileSync(EMP_PATH, 'utf-8'));
  res.json(data);
 } catch (e) {
  res.status(500).json({ error: 'read failed', details: e.message });
 }
});

// 2) 직원 목록 전체 교체
router.post('/employees', requireAdmin, (req, res) => {
 const { day_shift, night_shift } = req.body || {};
 if (!Array.isArray(day_shift) || !Array.isArray(night_shift)) {
  return res.status(400).json({ error: 'day_shift/night_shift must be arrays' });
 }
 const payload = {
  day_shift: sanitizeList(day_shift),
  night_shift: sanitizeList(night_shift)
 };
 try {
  atomicWrite(EMP_PATH, JSON.stringify(payload, null, 2));
  res.json({ ok: true, counts: { day: payload.day_shift.length, night: payload.night_shift.length } });
 } catch (e) {
  res.status(500).json({ error: 'write failed', details: e.message });
 }
});

// 3) 직원 추가 (단일 이름)
router.post('/employees/add', requireAdmin, (req, res) => {
 const { name, shift } = req.body || {};
 const s = (shift || 'DAY').toUpperCase();
 const nm = (name || '').trim();
 if (!nm) return res.status(400).json({ error: 'name required' });
 let data = { day_shift: [], night_shift: [] };
 if (fs.existsSync(EMP_PATH)) {
  data = JSON.parse(fs.readFileSync(EMP_PATH, 'utf-8'));
 }
 const target = s === 'NIGHT' ? data.night_shift : data.day_shift;
 if (!target.includes(nm)) target.push(nm);
 atomicWrite(EMP_PATH, JSON.stringify(data, null, 2));
 res.json({ ok: true });
});

// 4) 직원 삭제
router.post('/employees/remove', requireAdmin, (req, res) => {
 const { name, shift } = req.body || {};
 const nm = (name || '').trim();
 if (!nm) return res.status(400).json({ error: 'name required' });
 let data = { day_shift: [], night_shift: [] };
 if (fs.existsSync(EMP_PATH)) {
  data = JSON.parse(fs.readFileSync(EMP_PATH, 'utf-8'));
 }
 if (shift) {
  const s = shift.toUpperCase() === 'NIGHT' ? 'night_shift' : 'day_shift';
  data[s] = data[s].filter(n => n !== nm);
 } else {
  data.day_shift = data.day_shift.filter(n => n !== nm);
  data.night_shift = data.night_shift.filter(n => n !== nm);
 }
 atomicWrite(EMP_PATH, JSON.stringify(data, null, 2));
 res.json({ ok: true });
});

// 5) Vision 서비스 계정 키 업로드 (파일 교체)
router.post('/vision-key', requireAdmin, upload.single('file'), (req, res) => {
 if (!req.file) return res.status(400).json({ error: 'file required' });
 try {
  const raw = fs.readFileSync(req.file.path, 'utf-8');
  // JSON 포맷 검증
  JSON.parse(raw);
  atomicWrite(VISION_KEY_PATH, raw);
  fs.unlinkSync(req.file.path);
  // 권한 강화(선택)
  try { fs.chmodSync(VISION_KEY_PATH, 0o600); } catch {}
  res.json({ ok: true });
 } catch (e) {
  res.status(400).json({ error: 'invalid json', details: e.message });
 }
});

// 6) API 키(.env) 교체 (부분 치환)
router.post('/keys', requireAdmin, (req, res) => {
 const { GEMINI_API_KEY, GOOGLE_PROJECT_ID, ADMIN_TOKEN_NEW } = req.body || {};
 if (!GEMINI_API_KEY && !GOOGLE_PROJECT_ID && !ADMIN_TOKEN_NEW) {
  return res.status(400).json({ error: 'no keys provided' });
 }

 // 기존 .env 읽기 + 백업
 let original = '';
 if (fs.existsSync(ENV_PATH)) {
  original = fs.readFileSync(ENV_PATH, 'utf-8');
  const backupPath = ENV_PATH + '.bak.' + Date.now();
  fs.writeFileSync(backupPath, original, 'utf-8');
 }
 const lines = original.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('#'));

 function upsert(key, val) {
  if (val == null) return;
  const idx = lines.findIndex(l => l.startsWith(key + '='));
  const sanitized = String(val).replace(/\s+/g, '');
  if (idx >= 0) lines[idx] = `${key}=${sanitized}`;
  else lines.push(`${key}=${sanitized}`);
  process.env[key] = sanitized; // 런타임 반영(일부 로직 즉시 참조 가능)
 }

 upsert('GEMINI_API_KEY', GEMINI_API_KEY);
 upsert('GOOGLE_PROJECT_ID', GOOGLE_PROJECT_ID);
 if (ADMIN_TOKEN_NEW) upsert('ADMIN_TOKEN', ADMIN_TOKEN_NEW);

 atomicWrite(ENV_PATH, lines.join('\n') + '\n');

 res.json({ ok: true, updated: {
  GEMINI_API_KEY: !!GEMINI_API_KEY,
  GOOGLE_PROJECT_ID: !!GOOGLE_PROJECT_ID,
  ADMIN_TOKEN: !!ADMIN_TOKEN_NEW
 }, note: 'PM2 재시작 필요 시: pm2 restart timesheet-backend --update-env' });
});

module.exports = router;
