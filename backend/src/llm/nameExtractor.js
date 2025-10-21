const { isKoreanSurname } = require('./koreanSurnames');

const ONLY_HANGUL = /[^가-힣]/g;
const NOISE = /[()\[\]{}0-9\-.,:;!?·•]/g;

function clean(t='') {
 return t.replace(NOISE, ' ').replace(/\s+/g, '').replace(ONLY_HANGUL, '');
}
function centerY(box){ return (box[0].y + box[1].y + box[2].y + box[3].y)/4; }
function left(box){ return Math.min(box[0].x, box[3].x); }
function right(box){ return Math.max(box[1].x, box[2].x); }

function groupByRow(tokens, alignPx=14) {
 const rows = [];
 for (const tk of tokens) {
  const y = centerY(tk.boundingBox);
  const txt = clean(tk.text);
  if (!txt) continue;
  let bucket = rows.find(r => Math.abs(r.y - y) <= alignPx);
  if (!bucket) { bucket = { y, items: [] }; rows.push(bucket); }
  bucket.items.push({ txt, box: tk.boundingBox });
 }
 // x 오름차순 정렬
 rows.forEach(r => r.items.sort((a,b)=> left(a.box)-left(b.box)));
 return rows;
}

function recombineRow(row, gapPx=40) {
 const out = new Set();

 const items = row.items;

 // 단일 토큰이 이미 2~3글자: 그대로 후보
 for (const it of items) {
  if (it.txt.length>=2 && it.txt.length<=3 && isKoreanSurname(it.txt[0])) {
   out.add(it.txt);
  }
 }

 for (let i=0;i<items.length;i++){
  const a = items[i];

  // 1) 성(1) + 이름(1~2)
  if (a.txt.length===1 && isKoreanSurname(a.txt[0])) {
   const b = items[i+1];
   if (b) {
    const gap = left(b.box)-right(a.box);
    if (gap>=-4 && gap<=gapPx && b.txt.length>=1 && b.txt.length<=2) {
     const name = (a.txt + b.txt);
     if (name.length>=2 && name.length<=3) out.add(name);
    }
    const c = items[i+2];
    if (b && c) {
     const gap2 = left(c.box)-right(b.box);
     if (gap>=-4 && gap<=gapPx && gap2>=-4 && gap2<=gapPx && b.txt.length===1 && c.txt.length===1) {
      const name = a.txt + b.txt + c.txt;
      if (name.length===3) out.add(name);
     }
    }
   }
  }

  // 2) 2글자만 보인 경우(예: '장훈', '홍선'), 좌측 성씨 보강
  if (a.txt.length===2) {
   const leftNeighbor = items[i-1];
   if (leftNeighbor && leftNeighbor.txt.length===1 && isKoreanSurname(leftNeighbor.txt[0])) {
    const gap = left(a.box)-right(leftNeighbor.box);
    if (gap>=-4 && gap<=gapPx) out.add(leftNeighbor.txt + a.txt); // 황+장훈 → 황장훈
   }
   // 우측 1글자 결합(예: '홍선' + '자' → '홍선자')
   const rightNeighbor = items[i+1];
   if (rightNeighbor && rightNeighbor.txt.length===1) {
    const gapR = left(rightNeighbor.box)-right(a.box);
    if (gapR>=-4 && gapR<=gapPx) {
     // 성씨가 앞에 더 있으면 우선 '성+2글자'를 후보로, 그 외 보조 후보로 추가
     out.add(a.txt + rightNeighbor.txt);
    }
   }
  }
 }

 return [...out];
}

function extractKoreanNamesFromTokens(tokens, fallbackText='') {
 const rows = groupByRow(tokens);
 const names = new Set();
 for (const row of rows) {
  for (const n of recombineRow(row)) names.add(n);
 }
 // fallback 슬라이딩
 if (names.size===0 && fallbackText) {
  const cleaned = clean(fallbackText);
  for (let i=0;i<cleaned.length;i++){
   for (let len=2;len<=3;len++){
    const sub = cleaned.slice(i,i+len);
    if (sub.length>=2 && sub.length<=3 && isKoreanSurname(sub[0])) names.add(sub);
   }
  }
 }
 return [...names];
}

module.exports = { extractKoreanNamesFromTokens };