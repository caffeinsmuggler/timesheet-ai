// src/llm/geminiPipeline.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { preprocessImage } = require('../lib/preprocessImage');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 직원 데이터 로드
function loadEmployeeData() {
try {
const dataPath = path.join(__dirname, '../../data/employees.json');
const data = fs.readFileSync(dataPath, 'utf-8');
return JSON.parse(data);
} catch (e) {
console.warn('⚠️ Employee data not found');
return { day_shift: [], night_shift: [], idiomatic_expressions: {} };
}
}

// STEP 1: Flash로 초벌 추출
async function flashExtract(imageBase64, mimeType) {
const inputBuffer = Buffer.from(imageBase64, 'base64');
// 전처리 적용
const processedBuffer = await preprocessImage(inputBuffer);
const processedBase64 = processedBuffer.toString('base64');
const model = genAI.getGenerativeModel({
model: 'gemini-2.5-pro' 
});

const prompt = `Extract ALL text from this Korean timesheet image.
For each entry, provide:
- column number (1-based)
- raw text as written
- position (approximate row)

Return JSON array:
[
{ "column": 1, "row": 1, "raw_name": "김철쑤", "raw_attendance": "정상" },
{ "column": 2, "row": 1, "raw_name": "이영희", "raw_attendance": "조퇴 1시간 30분" }
]

Do NOT correct or interpret. Extract exactly as written.`;

const imagePart = {
inlineData: {
data: processedBase64,
mimeType: 'image/jpeg'
}
};

const result = await model.generateContent([prompt, imagePart]);
const response = await result.response;
const text = response.text();

let jsonText = text.trim();
if (jsonText.startsWith('```')) {
jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

return JSON.parse(jsonText);
}

// STEP 2: Pro로 후보 생성 + Reasoning
async function proRefineWithCandidates(flashResult, employeeData) {
const model = genAI.getGenerativeModel({
model: 'gemini-2.5-pro' 
});

const dayList = employeeData.day_shift.join(', ');
const nightList = employeeData.night_shift.join(', ');

const prompt = `You are an expert name matcher for Korean employee timesheets.

**DAY_SHIFT (columns 1-2):** ${dayList}
**NIGHT_SHIFT (columns 3+):** ${nightList}

**Flash extraction result:**
${JSON.stringify(flashResult, null, 2)}

For EACH entry, generate:
1. Top 3 candidate names from the appropriate shift list (based on column)
2. Confidence score (0-100) for each candidate
3. Step-by-step reasoning explaining your choice

**Output schema:**
{
"entries": [
{
"column": 1,
"row": 1,
"raw_name": "김철쑤",
"candidates": [
{ "name": "김철수", "confidence": 85, "distance": 1 },
{ "name": "김철호", "confidence": 12, "distance": 3 },
{ "name": "김철순", "confidence": 3, "distance": 2 }
],
"selected": "김철수",
"reasoning": [
"Raw text: '김철쑤' (last character ambiguous)",
"Column 1 → DAY_SHIFT list",
"Levenshtein distance: 김철수(1), 김철순(2), 김철호(3)",
"Selected: 김철수 (closest match)"
],
"attendance_type": "정상",
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
async function processWithPipeline(imageBase64, mimeType = 'image/png') {
console.log('🔄 Stage 1: Flash extraction…');
const flashResult = await flashExtract(imageBase64, mimeType);
console.log(`✓ Extracted ${flashResult.length} entries`);

console.log('🔄 Stage 2: Pro refinement with reasoning…');
const employeeData = loadEmployeeData();
const proResult = await proRefineWithCandidates(flashResult, employeeData);
console.log(`✓ Generated candidates for ${proResult.entries.length} entries`);

return {
flash_raw: flashResult,
refined: proResult,
metadata: {
day_shift_count: employeeData.day_shift.length,
night_shift_count: employeeData.night_shift.length,
processed_at: new Date().toISOString()
}
};
}

module.exports = { processWithPipeline };