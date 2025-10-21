// src/llm/geminiClient.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path'); // 추가
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 직원 명단 및 관용 표현 로드
function loadEmployeeList() {
try {
const dataPath = path.join(__dirname, '../../data/employees.json');
const data = fs.readFileSync(dataPath, 'utf-8');
return JSON.parse(data);
} catch (e) {
console.warn('⚠️ Employee data not found, using empty lists');
return {
day_shift: [],
night_shift: [],
idiomatic_expressions: {}
};
}
}

// 개선된 시스템 프롬프트
function buildSystemInstruction(employeeData) {
const dayList = employeeData.day_shift.length > 0
? employeeData.day_shift.map(n => `- ${n}`).join('\n')
: '(empty)';

const nightList = employeeData.night_shift.length > 0
? employeeData.night_shift.map(n => `- ${n}`).join('\n')
: '(empty)';

const idiomList = Object.entries(employeeData.idiomatic_expressions)
.map(([key, val]) => `- "${key}" → ${val.type}${val.minutes ? ` ${val.minutes}분` : ''}`)
.join('\n');

return `You are an expert at transcribing Korean handwritten workplace timesheets (근무상황부).

**DAY_SHIFT employees (Columns 1-2):**
${dayList}

**NIGHT_SHIFT employees (Columns 3+):**
${nightList}

**Idiomatic expressions:**
${idiomList}

Extract ALL visible rows into JSON with this exact schema:
{
"sheet_title": "string or null",
"date": "YYYY-MM-DD",
"entries": [
{
"column": number,
"name": "string or null",
"attendance_type": "string or null",
"leave_early_minutes": number
}
],
"warnings": [
{
"type": "string",
"column": number,
"raw": "string",
"message": "string" 
}
]
}

**Critical Rules:**
1. **Column-aware Name Matching Priority**:
- Columns 1-2: Match ONLY against DAY_SHIFT list
- Columns 3+: Match ONLY against NIGHT_SHIFT list
- Use fuzzy logic (Levenshtein distance ≤ 2)
- If no match in designated list, set null and add warning:
{ "type": "NO_MATCH", "column": N, "raw": "원본텍스트", "message": "No match in [DAY/NIGHT]_SHIFT" }

2. **Time Format**: Normalize to 24-hour HH:MM (e.g., "9시" → "09:00")

3. **Early Leave Normalization**: Convert Korean time expressions to minutes:
- "1시간 30분" → 90
- "1.5시간" → 90
- "30분" → 30
- "2시간" → 120

4. **Idiomatic Expression Conversion**: Replace with standardized type and minutes from the list above.
- Add warning: { "type": "IDIOMATIC_CONVERSION", "column": N, "raw": "원본", "converted": "특휴 60분" }

5. **Early Leave Summation**:
- If multiple entries for same person on same date, sum all times
- Exception: If times are identical, treat as duplicate (do NOT sum)
- Add warning: { "type": "SUMMATION", "name": "이름", "entries": ["1시간", "30분"], "total": 90 }

6. **Output**: Return ONLY valid JSON, no markdown.

**Example:**
Input (Flash raw): Column 1: "김철쑤", Column 2: "이영희" (조퇴 1시간 30분), Column 5: "박민수" (육아)

{
"entries": [
{ "column": 1, "name": "김철수", "attendance_type": "연가", "leave_early_minutes": 0 },
{ "column": 2, "name": "이영희", "attendance_type": "조퇴", "leave_early_minutes": 90 },
{ "column": 5, "name": "박민수", "attendance_type": "특휴", "leave_early_minutes": 60 }
],
"warnings": [
{ "type": "NAME_CORRECTION", "column": 1, "raw": "김철쑤", "message": "Corrected to 김철수 (DAY_SHIFT)" },
{ "type": "IDIOMATIC_CONVERSION", "column": 5, "raw": "육아", "message": "Converted to 특휴 60분" }
]
}`;
}

async function processTimesheetWithGemini(imageBase64, mimeType = 'image/png') {
try {
const employeeData = loadEmployeeList();
const systemInstruction = buildSystemInstruction(employeeData);

const model = genAI.getGenerativeModel({
model: 'gemini-2.5-flash',
systemInstruction: systemInstruction
});

const prompt = "Transcribe this Korean timesheet image into the specified JSON format.";

const imagePart = {
inlineData: {
data: imageBase64,
mimeType: mimeType
}
};

console.log(`📋 Loaded ${employeeData.day_shift.length} DAY_SHIFT, ${employeeData.night_shift.length} NIGHT_SHIFT employees`);

const result = await model.generateContent([prompt, imagePart]);
const response = await result.response;
const text = response.text();

// JSON 추출 (마크다운 코드블록 제거)
let jsonText = text.trim();

// ```json … ``` 형식 제거
if (jsonText.startsWith('```')) {
jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

const parsed = JSON.parse(jsonText);

return parsed;

} catch (error) {
console.error('Gemini API Error:', error);

// 에러 상세 정보 로깅
if (error.response) {
console.error('Response error:', error.response);
}

throw error;
}
}

module.exports = { processTimesheetWithGemini };