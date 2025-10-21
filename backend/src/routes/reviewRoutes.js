const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const sharp = require('sharp');
const { saveSession, loadSession, updateItem } = require('../llm/reviewSessionStore');
const { buildReviewSessionFromProcessed, quadToRect } = require('../llm/reviewSessionBuilder');
// 아래로 교체
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { visionExtract } = require('../llm/visionPipeline');
const { extractKoreanNamesFromTokens } = require('../llm/nameExtractor');
const { matchAgainstEmployees } = require('../llm/matcher');

const router = express.Router();

// LLM JSON 텍스트 정리 유틸
function parseJsonText(txt) {
 let t = (txt || '').trim();
 if (t.startsWith('```')) t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
 return JSON.parse(t);
}

// 간단한 중복 판별: 같은 column이고 이름이 같고, bbox가 있으면 중심거리로 근접 판단
function isDuplicate(existingItems, cand, bboxTolerance=32) {
 const sameCol = existingItems.filter(it => it.column === cand.column);
 for (const it of sameCol) {
  if (it.raw_name === cand.name) return true;
  const bb = it?.bbox?.vertices;
  const cb = cand.approx_box;
  if (bb && cb) {
   const cx1 = (bb[0].x + bb[2].x)/2, cy1 = (bb[0].y + bb[2].y)/2;
   const cx2 = (cb.x0 + cb.x1)/2, cy2 = (cb.y0 + cb.y1)/2;
   const d = Math.hypot(cx1 - cx2, cy1 - cy2);
   if (d <= bboxTolerance) return true;
  }
 }
 return false;
}

// 숫자/정수 보정
function toInt(n, def=0) {
 const v = Number.isFinite(n) ? Math.round(n) : def;
 return Number.isFinite(v) ? v : def;
}

function clamp(v, lo, hi) {
 return Math.min(Math.max(v, lo), hi);
}

// 이미지 메타 확보(세션에 width/height 없으면 파일에서 읽기)
async function ensureImageMeta(session) {
 if (session.width && session.height) {
  return { width: session.width, height: session.height };
 }
 const meta = await sharp(session.imagePath).metadata();
 // 세션에 저장해 두면 다음 호출부터 빠릅니다(선택)
 session.width = meta.width;
 session.height = meta.height;
 return { width: meta.width, height: meta.height };
}

// bbox(사각형 꼭짓점 네 점) → 안전한 extract rect로 변환
function safeRectFromVertices(vertices, imgW, imgH, pad = 10) {
 if (!Array.isArray(vertices) || vertices.length < 4) return null;
 const xs = vertices.map(v => Number(v?.x));
 const ys = vertices.map(v => Number(v?.y));
 if (xs.some(Number.isNaN) || ys.some(Number.isNaN)) return null;

 // 1) 최소/최대 + padding
 let minX = Math.min(...xs) - pad;
 let minY = Math.min(...ys) - pad;
 let maxX = Math.max(...xs) + pad;
 let maxY = Math.max(...ys) + pad;

 const overshootX = (maxX > imgW || minX < 0);
const overshootY = (maxY > imgH || minY < 0);
if (overshootX || overshootY) {
 console.warn('CROP overshoot: bbox exceeds image bounds', { imgW, imgH, minX, minY, maxX, maxY });
}

 // 2) 클램프
 minX = clamp(minX, 0, imgW - 1);
 minY = clamp(minY, 0, imgH - 1);
 maxX = clamp(maxX, 0, imgW - 1);
 maxY = clamp(maxY, 0, imgH - 1);

 // 3) 정수화
 minX = toInt(minX, 0);
 minY = toInt(minY, 0);
 maxX = toInt(maxX, 0);
 maxY = toInt(maxY, 0);

 // 4) 너비/높이 계산
 let width = maxX - minX;
 let height = maxY - minY;

 // 5) 디제너레이트 복구(너비/높이 < 2이면 중심 주변으로 최소 박스 구성)
 if (width < 2 || height < 2) {
  const cx = clamp(toInt(xs.reduce((a,b)=>a+b,0)/xs.length, 0), 0, imgW - 1);
  const cy = clamp(toInt(ys.reduce((a,b)=>a+b,0)/ys.length, 0), 0, imgH - 1);
  const half = 12; // 최소 24x24 박스
  minX = clamp(cx - half, 0, imgW - 1);
  minY = clamp(cy - half, 0, imgH - 1);
  maxX = clamp(cx + half, 0, imgW - 1);
  maxY = clamp(cy + half, 0, imgH - 1);
  width = Math.max(1, maxX - minX);
  height = Math.max(1, maxY - minY);
 }

 return { left: minX, top: minY, width, height };
}



// employees.json 로더(shift별 리스트 반환)
function loadEmployeeData() {
 const p = path.join(__dirname, '../../data/employees.json');
 if (!fs.existsSync(p)) {
  throw new Error(`employees.json not found at ${p}`);
 }
 const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
 return json; // { day_shift: […], night_shift: […] }
}

// 결과 JSON 로더(경로 후보 + 재시도 + 스키마 래핑)
async function getProcessedResult(fileId, { retries = 6, delayMs = 150 } = {}) {
 const candidates = [
  path.join(__dirname, `../../results/${fileId}.json`),    // 현재 저장 경로(로그 기준)
  path.join(__dirname, `../../data/results/${fileId}.json`), // 이전 경로 호환
  path.join(process.cwd(), `backend/results/${fileId}.json`), // 프로세스 기준 보정
  path.join(process.cwd(), `results/${fileId}.json`),
 ];

 const findExistingPath = () => {
  for (const p of candidates) {
   if (fs.existsSync(p)) return p;
  }
  return null;
 };

 let found = findExistingPath();
 let attempt = 0;
 while (!found && attempt < retries) {
  await new Promise(r => setTimeout(r, delayMs));
  found = findExistingPath();
  attempt++;
 }

 if (!found) {
  throw new Error('Processed JSON not found');
 }

 const loaded = JSON.parse(fs.readFileSync(found, 'utf-8'));
 // 호환성: 최상단 result 키가 없으면 감싸서 반환
 return loaded && loaded.result ? loaded : { result: loaded };
}

// 세션 생성
router.post('/sessions', async (req, res) => {
 try {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId is required' });

  const processed = await getProcessedResult(fileId);

  // 리뷰 세션 구성
  const session = buildReviewSessionFromProcessed({ fileId, processedJson: processed });
  saveSession(session);
  res.json({ sessionId: session.id });
 } catch (e) {
  console.error(e);
  res.status(500).json({ error: e.message });
 }
});

// 세션 조회
router.get('/sessions/:sid', (req, res) => {
 try {
  const s = loadSession(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
 } catch (e) {
  console.error(e);
  res.status(500).json({ error: e.message });
 }
});

// 전체 워핑 이미지 반환(오버레이용)
router.get('/sessions/:sid/image', (req, res) => {
 try {
  const s = loadSession(req.params.sid);
  if (!s || !s.imagePath) return res.status(404).end();
  const ext = (s.imagePath.split('.').pop() || '').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.sendFile(s.imagePath);
 } catch (e) {
  console.error(e);
  res.status(500).end();
 }
});

// 썸네일 크롭
router.get('/sessions/:sid/items/:iid/crop', async (req, res) => {
 const s = loadSession(req.params.sid);
 if (!s) { console.warn('CROP 404: session not found', req.params.sid); return res.status(404).end(); }
 if (!s.imagePath) { console.warn('CROP 404: imagePath missing'); return res.status(404).end(); }
 if (!fs.existsSync(s.imagePath)) { console.warn('CROP 404: file not exists', s.imagePath); return res.status(404).end(); }

 const item = s.items.find(x => x.id === req.params.iid);
 if (!item) { console.warn('CROP 404: item not found', req.params.iid); return res.status(404).end(); }

 const vertices = item?.bbox?.vertices;
 if (!vertices || vertices.length < 4) { console.warn('CROP 404: bbox missing', item.id); return res.status(404).end(); }

 try {
  const { width: imgW, height: imgH } = await ensureImageMeta(s);
  const rect = safeRectFromVertices(vertices, imgW, imgH, 10);

  if (!rect || rect.width < 1 || rect.height < 1) {
   console.warn('CROP 416: invalid rect computed', rect);
   return res.status(416).json({ error: 'invalid crop rect' });
  }

  const buf = await sharp(s.imagePath)
   .extract(rect)      // 안전한 rect
   .resize({ width: 180 })  // 썸네일
   .png()
   .toBuffer();

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
 } catch (e) {
  console.error('CROP 500:', e.message, { sid: s.id, iid: item.id });
  res.status(500).json({ error: 'extract failed', details: e.message });
 }
});

router.get('/sessions/:sid/download', (req, res) => {
 try {
  const { sid } = req.params;
  const session = loadSession(sid);
  if (!session) return res.status(404).json({ error: 'session not found' });

  const rows = (session.items || []).map(it => ({
   id: it.id,
   row: it.row,
   column: it.column,
   raw_name: it.raw_name || '',
   selected: it.selected || '',
   shift: it.shift || '',
   leave_type: it.leave_type || 'Unknown',
   status: it.status || 'unresolved',
   resolvedAt: it.resolvedAt || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Items');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="timesheet_${sid}.xlsx"`);
  return res.send(buf);
 } catch (e) {
  console.error('download error:', e);
  return res.status(500).json({ error: 'download failed', details: e.message });
 }
});

// 후보 선택/수정(없으면 직원 명단 검색 결과로 선택)
router.patch('/sessions/:sid/items/:iid', (req, res) => {
 try {
 const { selected, customName, leave_type, raw_name } = req.body || {};
 const s = loadSession(req.params.sid);
 if (!s) return res.status(404).json({ error: 'Session not found' });
 const idx = s.items.findIndex(x => x.id === req.params.iid);
 if (idx < 0) return res.status(404).json({ error: 'Item not found' });

 const base = s.items[idx];
 const patch = {};
 if (typeof leave_type === 'string' && leave_type.trim()) patch.leave_type = leave_type.trim();
 if (typeof raw_name === 'string' && raw_name.trim()) {
  patch.raw_name = raw_name.trim();
  patch.selected = null;
  patch.status = 'unresolved';
 }
 if (typeof selected === 'string' || typeof customName === 'string') {
  const name = (customName || selected || '').trim();
  if (name) {
  patch.selected = name;
  patch.status = 'resolved';
  patch.flags = Array.isArray(base.flags) ? base.flags.filter(f => f !== 'low_confidence' && f !== 'maybe_non_name') : [];
  }
 }
 patch.rev = (base.rev || 0) + 1;
 patch.updatedAt = new Date().toISOString();

 const updated = updateItem(req.params.sid, req.params.iid, patch);
 res.json(updated);
 } catch (e) {
 console.error(e);
 res.status(500).json({ error: e.message });
 }
});

// PATCH /api/review/sessions/:sid/items/:iid
/*
router.patch('/review/sessions/:sid/items/:iid', (req, res) => {
 const { sid, iid } = req.params;
 const { selected, leave_type } = req.body || {};
 const session = loadSession(sid); // 세션 로드 유틸
 const item = session.items.find(x => x.id === iid);
 if (!item) return res.status(404).json({ error: 'item not found' });

 if (typeof selected === 'string' && selected.trim()) {
  item.selected = selected.trim();
  item.status = 'resolved';    // ← 확정 처리 핵심
  item.resolvedAt = new Date().toISOString();
 }
 if (typeof leave_type === 'string') {
  item.leave_type = leave_type;
 }

 saveSession(session); // 세션 저장 유틸
 return res.json(item);
});
*/

// 직원 검색(오토컴플릿)
router.get('/employees', (req, res) => {
 try {
  const { q = '', shift } = req.query;
  const data = loadEmployeeData();
  let pool = shift === 'NIGHT' ? (data.night_shift || []) : (data.day_shift || []);
  const query = (q || '').trim();
  if (query) {
   pool = pool.filter(n => n.includes(query));
  }
  res.json({ items: pool.slice(0, 50) });
 } catch (e) {
  console.error(e);
  res.status(500).json({ error: e.message });
 }
});

router.post('/sessions/:sid/llm-fill', async (req, res) => {
 try {
  const sid = req.params.sid;
  const s = loadSession(sid);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (!s.imagePath || !fs.existsSync(s.imagePath)) return res.status(404).json({ error: 'Image not found' });

  // 이미지 base64
  const imgBuf = fs.readFileSync(s.imagePath);
  const mime = s.imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const base64 = imgBuf.toString('base64');

  // Vision 토큰 재사용(있으면) 또는 재추출
  const { width: imgW, height: imgH } = await ensureImageMeta(s);
  const visionBlocks = await visionExtract(base64); // tokens + paragraph bbox
  const compactTokens = visionBlocks.map((b, i) => ({
   i,
   text: (b.text || '').slice(0, 60),
   bbox: b.boundingBox,
   tokenCount: (b.tokens || []).length
  }));

  // Gemini 호출
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `
너는 한국어 근무상황부 이미지를 표 구조로 복원하는 전문가다.
- 표의 열 의미:
 1: 휴가유형 라벨(연가/조퇴/병가/특휴/교육 등), 2~3: 보안일근(주간), 4~7: 야근(1~4부)
- 너의 임무:
 1) 이름 목록을 행 단위로 추출하되, 각 이름에 column(2~7)과 leave_type(연가/조퇴/병가/특휴/교육/Unknown)을 붙인다.
 2) Vision OCR가 놓친 이름도 이미지 문맥을 보고 보완한다(가능하면).
 3) 각 이름에 대략적인 박스 approx_box를 제공한다: {x0,y0,x1,y1} (이미지 좌표, 픽셀)
- 제약:
 - column은 2~7 중 하나여야 한다.
 - leave_type은 ['연가','조퇴','병가','특휴','교육','Unknown'] 중 하나.
 - approx_box는 대략치여도 좋지만 빈 값은 피한다(없을 경우 null 허용).
- 출력 JSON만 반환:

{
 "items":[
  {
   "name":"홍길동",
   "column":4,
   "leave_type":"연가",
   "approx_box":{"x0":720,"y0":380,"x1":860,"y1":430},
   "reasoning":["열 헤더/섹션 문맥상 야근 1부","라벨과 동일행 배치"]
  }
 ]
}
참고: Vision 요약 토큰(일부, 좌표 있음)
${JSON.stringify(compactTokens, null, 2)}
이미지 크기: ${imgW}x${imgH} 픽셀
주의: JSON만 반환하고 설명 텍스트는 쓰지 마라.
  `.trim();

  const imagePart = { inlineData: { data: base64, mimeType: mime } };
  const resp = await model.generateContent([prompt, imagePart]);
  const txt = resp.response.text();
  let parsed;
  try {
   parsed = parseJsonText(txt);
  } catch (e) {
   console.warn('LLM JSON parse failed, raw:', txt.slice(0, 200));
   return res.status(502).json({ error: 'llm parse failed' });
  }

  const employeeData = loadEmployeeData();
  const now = new Date().toISOString();

  let added = 0;
  for (const it of (parsed.items || [])) {
   const col = Number(it.column);
   const name = (it.name || '').trim();
   if (!name || !(col >= 2 && col <= 7)) continue;

   // 중복 스킵
   if (isDuplicate(s.items, it)) continue;

   // 후보 매칭
   const entry = { row: 0, column: col, raw_name: name, leaveType: it.leave_type || 'Unknown' };
   const { candidates, selected } = matchAgainstEmployees(entry, employeeData);

   // 새 id
   const maxIdx = s.items.reduce((m, e) => Math.max(m, parseInt((e.id||'').split('_')[1]) || 0), 0);
   const newId = `it_${maxIdx + 1}`;
   const shift = col >= 4 ? 'NIGHT' : 'DAY';

   // bbox 구성
   let bbox = null;
   if (it.approx_box && Number.isFinite(it.approx_box.x0)) {
    const { x0,y0,x1,y1 } = it.approx_box;
    bbox = { vertices: [ {x:x0,y:y0}, {x:x1,y:y0}, {x:x1,y:y1}, {x:x0,y:y1} ] };
   }

   // row 자동 배정(해당 열의 최종행+1)
   const sameColRows = s.items.filter(e => e.column === col).map(e => e.row || 0);
   const nextRow = (sameColRows.length ? Math.max(...sameColRows) : 0) + 1;

   s.items.push({
    id: newId,
    row: nextRow,
    column: col,
    shift,
    leave_type: entry.leaveType,
    raw_name: name,
    candidates: (candidates || []).slice(0,3),
    selected: null, // 미확정으로 시작
    status: 'unresolved',
    flags: [],
    bbox,
    rev: 1,
    createdAt: now
   });
   added++;
  }

  saveSession(s);
  res.json({ ok: true, added, session: s });
 } catch (e) {
  console.error('llm-fill error:', e);
  res.status(500).json({ error: 'llm-fill failed', details: e.message });
 }
});

// 새 항목 추가 라우트
router.post('/sessions/:sid/items', async (req, res) => {
 try {
 const { vertices, raw_name, column, row, leave_type } = req.body || {};
 const s = loadSession(req.params.sid);
 if (!s) return res.status(404).json({ error: 'Session not found' });
 if (!s.imagePath || !fs.existsSync(s.imagePath)) return res.status(404).json({ error: 'Image not found' });

 // 이름 결정: vertices 있으면 크롭→OCR, 아니면 raw_name 사용
 let name = (raw_name || '').trim();
 if (!name && Array.isArray(vertices) && vertices.length === 4) {
  const { width: imgW, height: imgH } = await ensureImageMeta(s);
  const rect = safeRectFromVertices(vertices, imgW, imgH, 8);
  if (!rect) return res.status(416).json({ error: 'invalid crop rect' });
  const buf = await sharp(s.imagePath).extract(rect).png().toBuffer();
  const base64 = buf.toString('base64');
  const blocks = await visionExtract(base64);
  const tokens = blocks.flatMap(b => b.tokens || []);
  const names = extractKoreanNamesFromTokens(tokens, (blocks[0]?.text) || '');
  name = (names[0] || (blocks[0]?.text || '').replace(/\s+/g, '') || '').trim();
 }
 if (!name) return res.status(400).json({ error: 'raw_name or vertices required' });

 // column/row 결정
 const col = Number.isFinite(column) ? Number(column) : (s.items.find(it => it.id)?.column || 2);
 const sameColRows = s.items.filter(it => it.column === col).map(it => it.row || 0);
 const nextRow = Number.isFinite(row) ? Number(row) : ((sameColRows.length ? Math.max(...sameColRows) : 0) + 1);
 const shift = col >= 4 ? 'NIGHT' : 'DAY';

 // 후보 매칭
 const employeeData = loadEmployeeData();
 const entry = { row: nextRow, column: col, raw_name: name, leaveType: leave_type || 'Unknown' };
 const { candidates, selected, reasoning } = matchAgainstEmployees(entry, employeeData);

 // 새 it_id 생성
 const maxIdx = s.items.reduce((m, it) => Math.max(m, parseInt((it.id || '').split('_')[1]) || 0), 0);
 const newId = `it_${maxIdx + 1}`;

 const newItem = {
  id: newId,
  row: nextRow,
  column: col,
  shift,
  leave_type: leave_type || 'Unknown',
  raw_name: name,
  candidates: (candidates || []).slice(0, 3),
  selected: null, // 사용자 검토 전이므로 미확정
  status: 'unresolved',
  flags: [],
  bbox: Array.isArray(vertices) && vertices.length === 4 ? { vertices } : null,
  rev: 1,
  createdAt: new Date().toISOString(),
 };

 s.items.push(newItem);
 saveSession(s);
 res.json(newItem);
 } catch (e) {
 console.error('add item error:', e);
 res.status(500).json({ error: 'add item failed', details: e.message });
 }
});

// [신규] 선택 영역 재-OCR
router.post('/sessions/:sid/items/:iid/reocr', async (req, res) => {
 try {
 const { vertices } = req.body || {};
 const s = loadSession(req.params.sid);
 if (!s) return res.status(404).json({ error: 'Session not found' });
 if (!s.imagePath || !fs.existsSync(s.imagePath)) return res.status(404).json({ error: 'Image not found' });
 const itemIdx = s.items.findIndex(x => x.id === req.params.iid);
 if (itemIdx < 0) return res.status(404).json({ error: 'Item not found' });

 // bbox 업데이트(넘겨주면 교체)
 if (Array.isArray(vertices) && vertices.length === 4) {
  s.items[itemIdx].bbox = { vertices };
 }
 const bb = s.items[itemIdx].bbox?.vertices;
 if (!bb) return res.status(400).json({ error: 'bbox missing' });

 // 크롭해서 Vision→토큰→이름 추출→매칭
 const { width: imgW, height: imgH } = await ensureImageMeta(s);
 const rect = safeRectFromVertices(bb, imgW, imgH, 8);
 if (!rect) return res.status(416).json({ error: 'invalid crop rect' });

 const buf = await sharp(s.imagePath).extract(rect).png().toBuffer();
 const base64 = buf.toString('base64');

 const visionBlocks = await visionExtract(base64);
 // 크롭 이미지라 한 블록만 나오는 경우가 많음 → 토큰 합치기
 const allTokens = visionBlocks.flatMap(b => b.tokens || []);
 const names = extractKoreanNamesFromTokens(allTokens, (visionBlocks[0]?.text) || '');
 const rawName = names[0] || (visionBlocks[0]?.text || '').replace(/\s+/g, '');

 // 후보 매칭(교대는 column 기반)
 const e = { row: s.items[itemIdx].row, column: s.items[itemIdx].column, raw_name: rawName, leaveType: s.items[itemIdx].leave_type };
 const employeeData = loadEmployeeData();
 const { candidates, selected, reasoning } = matchAgainstEmployees(e, employeeData);

 // 아이템 갱신(선택은 보류 상태로)
 s.items[itemIdx] = {
  ...s.items[itemIdx],
  raw_name: rawName,
  candidates: (candidates || []).slice(0,3),
  selected: null,
  status: 'unresolved',
  rev: (s.items[itemIdx].rev || 0) + 1,
  updatedAt: new Date().toISOString()
 };

 saveSession(s);
 res.json(s.items[itemIdx]);
 } catch (e) {
 console.error('reOCR error:', e);
 res.status(500).json({ error: 'reocr failed', details: e.message });
 }
});

// 삭제: 등록된 이름(아이템) 제거
router.delete('/sessions/:sid/items/:iid', (req, res) => {
 try {
  const s = loadSession(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Session not found' });

  const idx = s.items.findIndex(x => x.id === req.params.iid);
  if (idx < 0) return res.status(404).json({ error: 'Item not found' });

  const removed = s.items.splice(idx, 1)[0];
  saveSession(s);
  res.json({ ok: true, removedId: removed.id, remaining: s.items.length });
 } catch (e) {
  console.error('DELETE item error:', e);
  res.status(500).json({ error: 'delete failed', details: e.message });
 }
});

router.post('/sessions/:sid/items/:iid/clear', (req, res) => {
 try {
  const s = loadSession(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const idx = s.items.findIndex(x => x.id === req.params.iid);
  if (idx < 0) return res.status(404).json({ error: 'Item not found' });

  const base = s.items[idx];
  const updated = updateItem(req.params.sid, req.params.iid, {
   selected: null,
   status: 'unresolved',
   rev: (base.rev || 0) + 1,
   updatedAt: new Date().toISOString()
  });
  res.json(updated);
 } catch (e) {
  console.error('clear item error:', e);
  res.status(500).json({ error: 'clear failed', details: e.message });
 }
});



// [신규] 세션 최종 확정
router.post('/sessions/:sid/finalize', (req, res) => {
 try {
 const s = loadSession(req.params.sid);
 if (!s) return res.status(404).json({ error: 'Session not found' });

 const pending = s.items.filter(it => it.status !== 'resolved');
 if (pending.length) {
  return res.status(400).json({
  error: 'unresolved items remain',
  count: pending.length,
  itemIds: pending.map(i => i.id)
  });
 }



 // 결과 파일에 최종 이름 명단 저장
 const resultsDir = path.join(__dirname, '../../results');
 const fileId = s.fileId;
 const finalPath = path.join(resultsDir, `${fileId}_final.json`);
 const finalPayload = {
  fileId,
  imagePath: s.imagePath || null,
  finalizedAt: new Date().toISOString(),
  items: s.items.map(it => ({
  row: it.row, column: it.column, name: it.selected, shift: it.shift, leave_type: it.leave_type
  }))
 };
 if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
 fs.writeFileSync(finalPath, JSON.stringify(finalPayload, null, 2), 'utf-8');

 res.json({ ok: true, finalPath });
 } catch (e) {
 console.error('finalize error:', e);
 res.status(500).json({ error: 'finalize failed', details: e.message });
 }
});

module.exports = router;