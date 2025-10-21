function levenshtein(a, b) {
 const m = a.length, n = b.length;
 const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
 for (let i=0; i<=m; i++) dp[i][0] = i;
 for (let j=0; j<=n; j++) dp[0][j] = j;
 for (let i=1; i<=m; i++) {
  for (let j=1; j<=n; j++) {
   const cost = a[i-1] === b[j-1] ? 0 : 1;
   dp[i][j] = Math.min(
    dp[i-1][j] + 1,
    dp[i][j-1] + 1,
    dp[i-1][j-1] + cost
   );
  }
 }
 return dp[m][n];
}
function top3Candidates(name, pool) {
 const scored = pool.map(p => ({ name: p, dist: levenshtein(name, p) }));
 scored.sort((a,b)=> a.dist - b.dist || a.name.localeCompare(b.name));
 const top = scored.slice(0,3);
 // 간단 confidence 매핑
 return top.map((t, idx) => {
  let conf;
  if (t.dist === 0) conf = [95,4,1][idx] || 1;
  else if (t.dist === 1) conf = [70,20,10][idx] || 5;
  else if (t.dist === 2) conf = [50,30,20][idx] || 5;
  else conf = [34,33,33][idx] || 1;
  return { name: t.name, confidence: conf, dist: t.dist };
 });
}
function matchAgainstEmployees(entry, employeeData) {
 const isNight = entry.column >= 4; // 4~7 야간
 const pool = isNight ? employeeData.night_shift : employeeData.day_shift;
 const cands = top3Candidates(entry.raw_name, pool);
 const selected = cands[0]?.name || null;

 const reasoning = [
  `Column ${entry.column} → ${isNight ? 'NIGHT' : 'DAY'}_SHIFT list.`,
  `Search name: '${entry.raw_name}'.`,
  ...(cands.length ? [`Top match distance: ${cands[0].dist}.`] : ['No candidate found.'])
 ];
 return { candidates: cands.map(({name, confidence})=>({name, confidence})), selected, reasoning };
}
module.exports = { matchAgainstEmployees };