const path = require('path');
const { isKoreanSurname } = require('../llm/koreanSurnames');

function quadToRect(vertices, pad = 6) {
 const xs = vertices.map(v => v.x);
 const ys = vertices.map(v => v.y);
 const minX = Math.max(0, Math.min(...xs) - pad);
 const minY = Math.max(0, Math.min(...ys) - pad);
 const maxX = Math.max(...xs) + pad;
 const maxY = Math.max(...ys) + pad;
 return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

// 이름 형태 휴리스틱: 한글 2~3자 + 첫 글자 성씨일 가능성
const ONLY_HANGUL = /^[가-힣]+$/;
function isProbableKoreanName(t) {
 if (!t || typeof t !== 'string') return false;
 const s = t.trim();
 if (!ONLY_HANGUL.test(s)) return false;
 if (s.length < 2 || s.length > 3) return false;
 return isKoreanSurname(s[0]);
}

// 노이즈 단어 빠르게 걸러내기(필요시 확장)
const NOISE_WORDS = new Set(['마감','인원','조정될','개소에','이송','이송등','기법','병원','교육','연가','조퇴','특휴','병가']);

function decideStatusAndSelection(rawName, candidates, selected) {
 const flags = [];
 const top = (candidates || [])[0];
 // 이름 형태 점검
 const nameOk = isProbableKoreanName(rawName) && !NOISE_WORDS.has(rawName);
 if (!nameOk) flags.push('maybe_non_name');

 // 신뢰도 기준(간단): top.confidence >= 85만 자동확정 허용
 const conf = top?.confidence ?? 0;
 if (conf < 85) flags.push('low_confidence');

 // selected 무효화: 기준 불충족 시 null
 const finalSelected = (selected && nameOk && top && selected === top.name && conf >= 85) ? selected : null;
 const status = finalSelected ? 'resolved' : 'unresolved';
 return { status, selected: finalSelected, flags };
}

// same row/column의 vision_parsed 엔트리 bbox를 재사용
function findCellBbox(visionParsed, row, column) {
 const cell = visionParsed.find(v => v.row === row && v.column === column);
 if (!cell || !cell.boundingBox) return null;
 const bb = cell.boundingBox;
 // vision_parsed.boundingBox가 사각형 꼭짓점 4개를 가진다고 가정
 if (Array.isArray(bb) && bb.length === 4 && bb[0].x !== undefined) {
  return { vertices: bb };
 }
 // 이미 vertices 포맷인 경우
 if (bb.vertices) return bb;
 return null;
}

function buildReviewSessionFromProcessed({ fileId, processedJson }) {
 const idPart = new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
 const sessionId = `rs_${idPart}_${fileId}`;

 const refinedEntries = processedJson.result?.refined?.entries || [];
 const visionParsed = processedJson.result?.vision_parsed || [];

 // 이미지 메타: 파이프라인에서 details에 저장해 두는 것을 권장
 const warpedImagePath =
  processedJson.result?.details?.warped_image_path ||
  processedJson.warpedImagePath || // 혹시 외부에서 주입
  null;
 const warpedWidth = processedJson.result?.details?.warped_width || null;
 const warpedHeight = processedJson.result?.details?.warped_height || null;

 let counter = 1;
 const items = refinedEntries.map(e => {
  const shift = e.column >= 4 ? 'NIGHT' : 'DAY';
  const bbox = findCellBbox(visionParsed, e.row, e.column) || { vertices: [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}] };

  // 후보 상위 3개만 보이기
  const candidates = (e.candidates || []).slice(0,3);

  // 자동선택 재게이트
  const { status, selected, flags } = decideStatusAndSelection(e.raw_name, candidates, e.selected);

  return {
   id: `it_${counter++}`,
   row: e.row,
   column: e.column,
   shift,
   leave_type: e.leave_type || 'Unknown',
   raw_name: e.raw_name,
   candidates,
   selected,      // 기준 불충족이면 null
   status,       // resolved | unresolved
   flags,        // ['maybe_non_name','low_confidence'] 등
   bbox,
   cropUrl: `/api/review/sessions/${sessionId}/items/it_${counter-1}/crop`
  };
 });

 return {
  id: sessionId,
  fileId,
  imagePath: warpedImagePath ? path.resolve(warpedImagePath) : null, // 없으면 null
  width: warpedWidth || null,
  height: warpedHeight || null,
  items,
  createdAt: new Date().toISOString()
 };
}

module.exports = { buildReviewSessionFromProcessed, quadToRect };