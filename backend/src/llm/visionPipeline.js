// src/llm/visionPipeline.js

const vision = require('@google-cloud/vision');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { extractKoreanNamesFromTokens } = require('./nameExtractor');
const { matchAgainstEmployees } = require('./matcher');

function postFixNames(visionParsed) {
 return visionParsed.map(e => {
  const names = new Set(e.extracted_names || []);
  // 2글자만 있으면 성씨/말미 보강 재시도
  if (names.size===1) {
   const only = [...names][0];
   if (only.length===2 && (e.tokens?.length)) {
    const repaired = extractKoreanNamesFromTokens(e.tokens, e.text);
    repaired.forEach(n => names.add(n));
   }
  }
  return { ...e, extracted_names: [...names] };
 });
}

// Vision API 클라이언트 초기화
const visionClient = new vision.ImageAnnotatorClient({
 keyFilename: process.env.VISION_CREDENTIALS_PATH
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 직원 데이터 로드
function loadEmployeeData() {
 try {
  const dataPath = path.join(__dirname, '../../data/employees.json');
console.log('📂 Loading employee data from:', dataPath);
const info = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(info);
 } catch (e) {
  console.warn('⚠️ Employee data not found');
  return { day_shift: [], night_shift: [], idiomatic_expressions: {} };
 }
}

// STEP 1: Vision API로 텍스트 + 좌표 추출
async function visionExtract(imageBase64) {
 console.log('🔍 Vision API: Extracting text with coordinates…');

 const imageBuffer = Buffer.from(imageBase64, 'base64');

 const [result] = await visionClient.documentTextDetection({
  image: { content: imageBuffer }
 });

 const fullTextAnnotation = result.fullTextAnnotation;

 if (!fullTextAnnotation) {
  console.warn('⚠️ No text detected');
  return [];
 }

 // 페이지 단위로 처리
 const pages = fullTextAnnotation.pages || [];
 const extractedEntries = [];

 for (const page of pages) {
  for (const block of page.blocks) {
   for (const paragraph of block.paragraphs) {
    const words = paragraph.words.map(word => {
     const text = word.symbols.map(s => s.text).join('');
     const boundingBox = word.boundingBox.vertices;
     return { text, boundingBox };
    });

    extractedEntries.push({
     text: words.map(w => w.text).join(' '),
     tokens: words, // ← 토큰 보존
     boundingBox: paragraph.boundingBox.vertices
    });
   }
  }
 }

 console.log(`✓ Vision extracted ${extractedEntries.length} text blocks`);
 return extractedEntries;
}

// 헤더 제외 함수
function filterHeaders(entries) {
 const headerKeywords = ['비고', '요일', '보안일근', '부()', '년', '월', '일'];

 return entries.filter(entry => {
  const text = entry.text.trim();

  // Row 1~2는 무조건 제외
  if (entry.boundingBox[0].y < 150) return false;

  // 헤더 키워드 포함 시 제외
  for (const keyword of headerKeywords) {
   if (text.includes(keyword)) return false;
  }

  return true;
 });
}

// X 좌표로 열 범위 할당
function assignColumnByX(entries) {
 return entries.map(entry => {
  const x = entry.boundingBox[0].x;
  let column;

  if (x < 200) column = 1;    // 휴가 유형 라벨
  else if (x < 400) column = 2;  // 보안일근 1~6
  else if (x < 600) column = 3;  // 보안일근 7~12
  else if (x < 800) column = 4;  // 야근 1부
  else if (x < 1000) column = 5; // 야근 2부
  else if (x < 1200) column = 6; // 야근 3부
  else column = 7;        // 야근 4부

  return { ...entry, column };
 });
}

// 휴가 유형 섹션 분리
function parseSections(entries) {
 const leaveTypes = ['연가', '조퇴', '병가', '특휴', '교육'];
 const sections = [];
 let currentSection = null;

 entries.forEach(entry => {
  if (entry.column === 1) {
   // 휴가 유형 라벨 발견 시 새 섹션 시작
   for (const type of leaveTypes) {
    if (entry.text.includes(type)) {
     if (currentSection) sections.push(currentSection);
     currentSection = { type, names: [] };
     return;
    }
   }
  }

  // Column 2 이상만 이름으로 간주
  if (entry.column >= 2 && currentSection) {
   currentSection.names.push(entry);
  }
 });

 if (currentSection) sections.push(currentSection);

 return sections;
}

function expandEntriesByNames(visionParsed) {
 const out = [];
 for (const e of visionParsed) {
  const names = e.extracted_names || [];
  if (names.length === 0) {
   // 이름이 없으면 스킵(또는 그대로 남겨서 '미식별'로 표기)
   continue;
  }
  for (const n of names) {
   out.push({
    row: e.row,
    column: e.column,
    raw_name: n,
    leaveType: e.leaveType,
    boundingBox: e.boundingBox,
    tokens: e.tokens || []
   });
  }
 }
 return out;
}

// 템플릿 기반 표 파싱 (근태부 전용)
function parseTimesheetTable(visionRaw) {
 console.log('📋 Parsing timesheet table with template…');

 // Step 1: 헤더 제거
 const filtered = filterHeaders(visionRaw);
 console.log(`✓ Filtered ${visionRaw.length - filtered.length} header entries`);

// Step 1.5: 토큰 기반 이름 추출
 console.log('🔍 Step 1.5: Extracting Korean names (token-level)…');
 const withNames = filtered.map(entry => {
  const names = extractKoreanNamesFromTokens(entry.tokens || [], entry.text || '');
  return { ...entry, extracted_names: names };
 });
 // Step 2: 열 범위 할당
 const withColumns = assignColumnByX(withNames);

 // Step 3: 섹션 파싱
 const sections = parseSections(withColumns);
 console.log(`✓ Parsed ${sections.length} leave type sections`);

 // Step 4: 평탄화 (섹션별 이름 추출)
 const result = [];
 sections.forEach(section => {
  section.names.forEach((entry, idx) => {
   result.push({
    row: idx + 1,
    column: entry.column,
    text: entry.text,
    extracted_names: entry.extracted_names || [],
    leaveType: section.type,
    boundingBox: entry.boundingBox,
    tokens: entry.tokens || []
   });
  });
 });

 return result;
}

// STEP 2: Pro로 후보 생성 (geminiPipeline과 동일)
async function proRefineWithCandidates(visionResult, employeeData) {
 const model = genAI.getGenerativeModel({
 model: 'gemini-2.5-pro'
 });

 const dayList = employeeData.day_shift.join(', ');
 const nightList = employeeData.night_shift.join(', ');

 const prompt = `You are an expert name matcher for Korean employee timesheets.

**DAY_SHIFT (columns 2-3):** ${dayList}
**NIGHT_SHIFT (columns 4-7):** ${nightList}

**Vision API extraction result:**
${JSON.stringify(visionResult, null, 2)}

For EACH entry, generate:
1. Top 3 candidate names from the appropriate shift list (based on column)
2. Confidence score (0-100) for each candidate
3. Step-by-step reasoning explaining your choice

**Output schema:**
{
 "entries": [
  {
   "column": 2,
   "row": 1,
   "raw_name": "김철수",
   "candidates": [
    { "name": "김철수", "confidence": 95 },
    { "name": "김철호", "confidence": 4 },
    { "name": "김철순", "confidence": 1 }
   ],
   "selected": "김철수",
   "reasoning": [
    "Vision OCR: '김철수' (clear text)",
    "Column 2 → DAY_SHIFT list",
    "Exact match found: 김철수",
    "Confidence: 95%"
   ],
   "leave_type": "연가",
"attendance_type": "Present",
   "leave_early_minutes": 0
  }
 ]
}

**Critical:**
- Explain your reasoning step by step
- Calculate Levenshtein distance accurately
- Sum confidence scores per entry to 100%
- Return ONLY valid JSON`;

 const result = await model.generateContent([prompt]);
 const response = await result.response;
 const text = response.text();

 let jsonText = text.trim();
 if (jsonText.startsWith('```')) {
 jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
 }

 return JSON.parse(jsonText);
}

// 전체 파이프라인
async function processWithVisionPipeline(imageBase64, mimeType = 'image/png') {
 console.log('🔄 Stage 1: Vision API extraction…');
 const visionRaw = await visionExtract(imageBase64);

 console.log('🔄 Stage 1.5: Template-based table parsing…');
 const parsed0 = parseTimesheetTable(visionRaw);
 console.log(`✓ Parsed ${parsed0.length} blocks`);

 // 1. 토큰 기반 이름 추출 추가
 console.log('🔍 Step 1.6: Token-level Korean name extraction…');
 const withNames = parsed0.map(entry => {
  const names = extractKoreanNamesFromTokens(entry.tokens || [], entry.text || '');
  return { ...entry, extracted_names: names };
 });

 // 2. 이름 보정(성씨/말미 보강)
 console.log('🛠️ Step 1.7: Name post-fix (surname/ending repair)…');
 const withNamesFixed = postFixNames(withNames);

 // 3. 여러 이름 확장
 console.log('🧩 Step 1.8: Expand entries by names…');
 const expanded = expandEntriesByNames(withNamesFixed);
 console.log(`✓ Expanded to ${expanded.length} name entries`);

 // 4. 로컬 매칭(LLM 미사용)
 console.log('🤝 Stage 2: Employee matching (local, jamo-distance)…');
 const employeeData = loadEmployeeData();
 const refinedEntries = expanded.map(e => {
  const { candidates, selected, reasoning } = matchAgainstEmployees(e, employeeData);
  return {
   column: e.column,
   row: e.row,
   raw_name: e.raw_name,
   candidates,
   selected,
   reasoning,
   leave_type: e.leaveType,
   attendance_type: 'Unknown',
   leave_early_minutes: 0
  };
 });

 return {
  vision_raw: visionRaw,
  // 보정된 엔트리를 vision_parsed로 반환(프론트에서 확인하기 쉬움)
  vision_parsed: withNamesFixed,
  refined: { entries: refinedEntries },
   details: {
    day_shift_count: employeeData.day_shift.length,
    night_shift_count: employeeData.night_shift.length,
    processed_at: new Date().toISOString(),
    warped_image_path: null,   // 추가 (값 미정시 null로 안전하게 설정)
    warped_width: null,        // 추가 (값 미정시 null로 안전하게 설정)
    warped_height: null        // 추가 (값 미정시 null로 안전하게 설정)
   }
 };
}

module.exports = {
 processWithVisionPipeline,
 visionExtract,
 loadEmployeeData
};