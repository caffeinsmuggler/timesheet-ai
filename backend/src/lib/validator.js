const fs = require('fs');
const path = require('path');

// Levenshtein distance (문자열 유사도)
function levenshtein(a, b) {
 const matrix = [];
 for (let i = 0; i <= b.length; i++) {
 matrix[i] = [i];
 }
 for (let j = 0; j <= a.length; j++) {
 matrix[0][j] = j;
 }
 for (let i = 1; i <= b.length; i++) {
 for (let j = 1; j <= a.length; j++) {
  if (b.charAt(i - 1) === a.charAt(j - 1)) {
  matrix[i][j] = matrix[i - 1][j - 1];
  } else {
  matrix[i][j] = Math.min(
   matrix[i - 1][j - 1] + 1,
   matrix[i][j - 1] + 1,
   matrix[i - 1][j] + 1
  );
  }
 }
 }
 return matrix[b.length][a.length];
}

// 가장 유사한 직원 이름 찾기
function findClosestName(input, candidateNames, threshold = 2) {
 if (!input || candidateNames.length === 0) return null;
 
 let closest = null;
 let minDistance = Infinity;
 
 for (const name of candidateNames) {
 const dist = levenshtein(input, name);
 if (dist < minDistance) {
  minDistance = dist;
  closest = name;
 }
 }
 
 return minDistance <= threshold ? closest : null;
}

// 시간 파싱 (HH:MM → 분)
function parseTime(timeStr) {
 if (!timeStr) return null;
 const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
 if (!match) return null;
 const h = parseInt(match[1], 10);
 const m = parseInt(match[2], 10);
 if (h > 23 || m > 59) return null;
 return h * 60 + m;
}

function validateResult(result, employeeData) {
const warnings = result.warnings || [];

// entries 검증 (서버 사이드 이중 체크)
if (result.entries) {
result.entries.forEach((entry, idx) => {
// 컬럼별 명단 확인
const isDay = entry.column >= 1 && entry.column <= 2;
const list = isDay ? employeeData.day_shift : employeeData.night_shift;

if (entry.name) {
const match = findClosestName(entry.name, list);
if (!match) {
warnings.push({
type: "VALIDATION_FAIL",
column: entry.column,
raw: entry.name,
message: `Server-side validation: Name not in ${isDay ? 'DAY' : 'NIGHT'}_SHIFT list`
});
}
}

// 시간 재계산 (옵션)
// (현재는 LLM이 계산하므로 서버 검증만)
});
}
 
 result.warnings = warnings;
 return result;
}

function loadEmployeeData() {
try {
const dataPath = path.join(__dirname, '../../data/employees.json');
const data = fs.readFileSync(dataPath, 'utf-8');
return JSON.parse(data);
} catch (e) {
return { day_shift: [], night_shift: [], idiomatic_expressions: {} };
}
}

module.exports = { validateResult, loadEmployeeData };