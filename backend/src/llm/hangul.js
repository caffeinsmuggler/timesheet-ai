// 자모 분해
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const JOONG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'.split('');
const JONG = ['-', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function decompose(ch){
 const code = ch.charCodeAt(0);
 if (code < 0xAC00 || code > 0xD7A3) return {cho: ch, jung: '', jong: ''};
 const idx = code - 0xAC00;
 const cho = Math.floor(idx / (21*28));
 const jung = Math.floor((idx % (21*28)) / 28);
 const jong = idx % 28;
 return { cho: CHO[cho], jung: JOONG[jung], jong: JONG[jong] || '-' };
}

function jamoCost(a, b) {
 if (a===b) return 0;
 const A = decompose(a), B = decompose(b);
 // 초성/중성/종성 가중치
 let cost = 0;
 cost += (A.cho===B.cho) ? 0 : 0.6;
 cost += (A.jung===B.jung) ? 0 : 0.3;
 cost += (A.jong===B.jong) ? 0 : 0.1;
 return Math.min(1, cost); // 최대 1
}

function jamoStringDistance(a='', b='') {
 const m=a.length, n=b.length;
 const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
 for (let i=0;i<=m;i++) dp[i][0]=i;
 for (let j=0;j<=n;j++) dp[0][j]=j;
 for (let i=1;i<=m;i++){
  for (let j=1;j<=n;j++){
   const rep = dp[i-1][j-1] + jamoCost(a[i-1], b[j-1]);
   const del = dp[i-1][j] + 1;
   const ins = dp[i][j-1] + 1;
   dp[i][j] = Math.min(rep, del, ins);
  }
 }
 return dp[m][n];
}

module.exports = { jamoStringDistance };

backend/src/llm/matcher.js
const { jamoStringDistance } = require('./hangul');
const { isKoreanSurname } = require('./koreanSurnames');

function scoreCandidate(query, cand) {
 // 성씨 보정: 동일 성씨면 큰 보너스, 다르면 패널티
 const sameSurname = (query[0] === cand[0]) && isKoreanSurname(query[0]);
 const dist = jamoStringDistance(query, cand);
 // 최종 스코어는 낮을수록 좋음
 const surnameBias = sameSurname ? -0.4 : +0.6; // 동일 성이면 더 유리
 return Math.max(0, dist + surnameBias);
}

function pickTop(query, pool, limit=3) {
 const rows = pool.map(p => ({ name: p, score: scoreCandidate(query, p) }));
 rows.sort((a,b)=> a.score - b.score || a.name.localeCompare(b.name));
 return rows.slice(0, limit);
}

// 자동 선택 임계값: 길이 3 기준 0.9 이하, 길이 2는 0.7 이하만 자동 선택
function shouldAutoSelect(queryLen, bestScore) {
 if (queryLen >= 3) return bestScore <= 0.9;
 if (queryLen === 2) return bestScore <= 0.7;
 return false;
}

function matchAgainstEmployees(entry, employeeData) {
 const isNight = entry.column >= 4;
 const pool = isNight ? employeeData.night_shift : employeeData.day_shift;

 // 1) 후보군 1차 게이트: 같은 성씨 우선. 없으면 전체.
 let pool1 = pool.filter(n => n[0] === entry.raw_name[0]);
 if (pool1.length === 0) pool1 = pool.slice(0);

 const top = pickTop(entry.raw_name, pool1, 3);
 const candidates = top.map((t, idx) => {
  // 간단 confidence: 점수 0→95, 0.5→80, 1.0→60, 그 이상 급강하
  const conf = t.score<=0.2 ? 95 : t.score<=0.5 ? 85 : t.score<=0.9 ? 70 : t.score<=1.3 ? 50 : 30 - idx*5;
  return { name: t.name, confidence: Math.max(1, Math.min(95, conf)) };
 });

 const bestScore = top[0]?.score ?? 9;
 const selected = shouldAutoSelect(entry.raw_name.length, bestScore) ? top[0].name : null;

 const reasoning = [
  `Column ${entry.column} → ${isNight ? 'NIGHT' : 'DAY'}_SHIFT.`,
  `Surname gate: ${pool1.length !== pool.length ? 'applied' : 'not available'}.`,
  `Jamo distance-based scoring. Best score=${bestScore.toFixed(2)}.`,
  selected ? 'Auto-selected within threshold.' : 'Below confidence threshold: left unresolved.'
 ];

 return { candidates, selected, reasoning };
}

module.exports = { matchAgainstEmployees };