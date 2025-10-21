// src/App.jsx
import { useState, useRef, useEffect } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// 간단 API 래퍼
async function apiPost(path, body) {
 const r = await fetch(`${API_BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
 });
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}
async function apiGet(path) {
 const r = await fetch(`${API_BASE}${path}`);
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}
async function apiPatch(path, body) {
 const r = await fetch(`${API_BASE}${path}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
 });
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}

async function apiDelete(path) {
 const r = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}

function CandidateRadios({ item, onSelect }) {
 const [custom, setCustom] = useState('');
 const [suggest, setSuggest] = useState([]);
 const [loading, setLoading] = useState(false);

 // 모바일 기본 ON, 데스크톱은 OFF
 const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
 const [autoConfirm, setAutoConfirm] = useState(isMobile);

 const idleTimerRef = useRef(null);

 async function handleSearch(q) {
  setLoading(true);
  try {
   const u = new URLSearchParams();
   if (q) u.set('q', q);
   if (item.shift) u.set('shift', item.shift);
   const res = await apiGet(`/review/employees?${u.toString()}`);
   setSuggest(res.items || []);
  } catch (e) {
   console.error(e);
   setSuggest([]);
  } finally {
   setLoading(false);
  }
 }

 function confirmSelect(name) {
  const v = (name ?? custom).trim();
  if (!v) return;
  onSelect(v);    // ReviewTable.handleSelect → PATCH → status=resolved
  setSuggest([]);  // 목록 닫기
 }

 function onInputChange(v) {
  setCustom(v);
  if (v.trim().length >= 1) handleSearch(v.trim());
  else setSuggest([]);

  // 자동 확정: 타이핑 멈추면 800ms 후 확정
  if (autoConfirm) {
   if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
   idleTimerRef.current = setTimeout(() => {
    if (v.trim()) confirmSelect(v);
   }, 800);
  }
 }

 // onBlur로도 확정(제안 클릭을 위해 약간 지연)
 function onInputBlur() {
  if (!autoConfirm) return;
  setTimeout(() => {
   if (custom.trim()) confirmSelect(custom);
  }, 120);
 }

 useEffect(() => () => {
  if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
 }, []);

 return (
  <div style={{ minWidth: 240 }}>
   {(item.candidates || []).map((c, i) => (
    <label key={i} style={{ display: 'block', marginBottom: 2 }}>
     <input
      type="radio"
      name={`cand-${item.id}`}
      onChange={() => confirmSelect(c.name)}
      checked={item.selected === c.name}
     />{' '}
     {c.name} ({c.confidence}%)
    </label>
   ))}

   <div style={{ marginTop: 6 }}>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
     <input
      placeholder="직원 검색/직접 입력"
      value={custom}
      onChange={(e) => onInputChange(e.target.value)}
      onBlur={onInputBlur}
      onKeyDown={(e) => {
       if (e.key === 'Enter' && custom.trim()) {
        confirmSelect(custom.trim());
       }
      }}
      style={{ width: 160 }}
      autoComplete="off"
      inputMode="text"
     />
     <button type="button" onClick={() => confirmSelect()} style={{ padding: '4px 8px' }}>
      확정
     </button>
     <label style={{ fontSize: 12, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
       type="checkbox"
       checked={autoConfirm}
       onChange={(e) => setAutoConfirm(e.target.checked)}
      />
      자동 확정
     </label>
     {loading && <div style={{ fontSize: 12, color: '#888' }}>검색 중…</div>}
    </div>

    {/* 모바일 호환을 위한 커스텀 제안 목록(datalist 대체) */}
    {suggest.length > 0 && (
     <div style={{ position: 'relative' }}>
      <ul
       style={{
        position: 'absolute',
        zIndex: 10,
        background: '#fff',
        border: '1px solid #ddd',
        width: 220,
        marginTop: 2,
        maxHeight: 160,
        overflowY: 'auto',
        listStyle: 'none',
        padding: 0
       }}
      >
       {suggest.map((n, idx) => (
        <li key={idx}>
         <button
          type="button"
          onMouseDown={(e) => e.preventDefault()} // blur 전에 클릭 보장
          onClick={() => confirmSelect(n)}
          style={{
           display: 'block',
           width: '100%',
           textAlign: 'left',
           padding: '6px 8px',
           background: 'white',
           border: 'none',
           borderBottom: '1px solid #eee',
           cursor: 'pointer'
          }}
         >
          {n}
         </button>
        </li>
       ))}
      </ul>
     </div>
    )}
   </div>
  </div>
 );
}

// 전체 이미지 위에 bbox를 하이라이트하는 미리보기
function ReviewPreview({ sessionId, data, selectedItem, onReOCRDone }) {
 const [imgSize, setImgSize] = useState({ w: 0, h: 0, scale: 0, natW: 0, natH: 0 });
 const [selecting, setSelecting] = useState(false);
 const [isDrawing, setIsDrawing] = useState(false);
 const [dragRect, setDragRect] = useState(null);  // {x0,y0,x1,y1}
 const [finalRect, setFinalRect] = useState(null); // 확정 영역
 const wrapperRef = useRef(null);

 // “새 항목 추가” 모드
 const [addMode, setAddMode] = useState(false);
 const [addLeaveType, setAddLeaveType] = useState('Unknown');
 const [manualName, setManualName] = useState('');
 const [manualColumn, setManualColumn] = useState(selectedItem?.column || 2);

 useEffect(() => {
  // 선택 아이템이 바뀌면 수동 입력 기본 열 동기화
  setManualColumn(selectedItem?.column || 2);
 }, [selectedItem?.column]);

 const containerW = 520;

 useEffect(() => {
  const onKey = (e) => {
   if (e.key === 'Escape') {
    setIsDrawing(false);
    setDragRect(null);
    setFinalRect(null);
   }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
 }, []);

 const onImgLoad = (e) => {
  const natW = e.currentTarget.naturalWidth || data.width || 1400;
  const natH = e.currentTarget.naturalHeight || data.height || 1050;
  const scale = containerW / natW;
  setImgSize({ w: natW * scale, h: natH * scale, scale, natW, natH });
 };

 function clientToLocal(clientX, clientY) {
  const el = wrapperRef.current;
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - r.left, imgSize.w));
  const y = Math.max(0, Math.min(clientY - r.top, imgSize.h));
  return { x, y };
 }

 function normRect(d) {
  if (!d) return null;
  const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1);
  const x1 = Math.max(d.x0, d.x1), y1 = Math.max(d.y0, d.y1);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
 }

 function toVertices(rect) {
  const s = imgSize.scale || 1;
  const r = normRect(rect);
  const x0 = Math.round(r.x0 / s), y0 = Math.round(r.y0 / s);
  const x1 = Math.round(r.x1 / s), y1 = Math.round(r.y1 / s);
  return [
   { x: x0, y: y0 }, // 좌상
   { x: x1, y: y0 }, // 우상
   { x: x1, y: y1 }, // 우하
   { x: x0, y: y1 }, // 좌하
  ];
 }

 const onPointerDown = (e) => {
  if (!selecting) return;
  const start = clientToLocal(e.clientX, e.clientY);
  setIsDrawing(true);
  setDragRect({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
  setFinalRect(null);

  const move = (ev) => {
   if (!isDrawing) return;
   const p = clientToLocal(ev.clientX, ev.clientY);
   setDragRect((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };
  const up = (ev) => {
   const end = clientToLocal(ev.clientX, ev.clientY);
   setIsDrawing(false);
   setDragRect((d) => {
    if (!d) return d;
    const dx = Math.abs((d.x0 ?? 0) - end.x);
    const dy = Math.abs((d.y0 ?? 0) - end.y);
    let r = { x0: d.x0, y0: d.y0, x1: end.x, y1: end.y };
    if (dx < 3 && dy < 3) {
     const half = 12;
     r = {
      x0: Math.max(0, d.x0 - half),
      y0: Math.max(0, d.y0 - half),
      x1: Math.min(imgSize.w, d.x0 + half),
      y1: Math.min(imgSize.h, d.y0 + half),
     };
    }
    setFinalRect(r);
    return r;
   });
   window.removeEventListener('pointermove', move);
   window.removeEventListener('pointerup', up);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
 };

 async function commitReOCR() {
  if (!selectedItem || !finalRect) return;
  try {
   const vertices = toVertices(finalRect);
   const updated = await apiPost(
    `/review/sessions/${sessionId}/items/${selectedItem.id}/reocr`,
    { vertices }
   );
   onReOCRDone?.(updated);
   setSelecting(false);
   setDragRect(null);
   setFinalRect(null);
  } catch (e) {
   alert(`재OCR 실패: ${e.message}`);
  }
 }

 async function commitAddByRect() {
  if (!finalRect) return;
  try {
   const vertices = toVertices(finalRect);
   const created = await apiPost(`/review/sessions/${sessionId}/items`, {
    vertices,
    leave_type: addLeaveType,
    column: selectedItem?.column || manualColumn
   });
   onReOCRDone?.(created);
   setSelecting(false);
   setDragRect(null);
   setFinalRect(null);
  } catch (e) {
   alert(`새 항목 추가 실패: ${e.message}`);
  }
 }

 async function commitAddManual() {
  const name = manualName.trim();
  if (!name) return alert('이름을 입력하세요');
  try {
   const created = await apiPost(`/review/sessions/${sessionId}/items`, {
    raw_name: name,
    column: manualColumn,
    leave_type: addLeaveType
   });
   onReOCRDone?.(created);
   setManualName('');
  } catch (e) {
   alert(`수동 추가 실패: ${e.message}`);
  }
 }

 const polygonPoints = (() => {
  const bb = selectedItem?.bbox?.vertices;
  if (!bb || !imgSize.scale) return '';
  return bb.map((v) => `${v.x * imgSize.scale},${v.y * imgSize.scale}`).join(' ');
 })();

 const drawRect = normRect(finalRect || dragRect);
 const hasDraw = !!drawRect && drawRect.w > 0 && drawRect.h > 0;

 return (
  <div style={{ border: '1px solid #ddd', padding: 8 }}>
   <div style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <div style={{ fontWeight: 600, flex: 1 }}>전체 이미지 미리보기</div>
    <label style={{ fontSize: 13 }}>
     <input
      type="checkbox"
      checked={selecting}
      onChange={(e) => {
       setSelecting(e.target.checked);
       setIsDrawing(false);
       setDragRect(null);
       setFinalRect(null);
      }}
     />{' '}
     영역 재선택
    </label>
    <label style={{ fontSize: 13 }}>
     <input
      type="checkbox"
      checked={addMode}
      onChange={(e) => setAddMode(e.target.checked)}
     />{' '}
     새 항목 추가 모드
    </label>
    <select value={addLeaveType} onChange={(e) => setAddLeaveType(e.target.value)}>
     {['연가','조퇴','병가','특휴','교육','Unknown'].map(opt => (
      <option key={opt} value={opt}>{opt}</option>
     ))}
    </select>
    <button disabled={!finalRect || addMode} onClick={commitReOCR}>
     선택영역 재-OCR(교체)
    </button>
    <button disabled={!finalRect || !addMode} onClick={commitAddByRect}>
     선택영역 새 항목 추가
    </button>
   </div>

   <div
    ref={wrapperRef}
    style={{ position: 'relative', width: containerW, height: 'auto', userSelect: 'none' }}
    onPointerDown={onPointerDown}
   >
    <img
     src={`${API_BASE}/review/sessions/${sessionId}/image`}
     onLoad={onImgLoad}
     style={{ width: containerW, height: 'auto', display: 'block' }}
     alt="warped"
     draggable={false}
     onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />

    {selectedItem?.bbox?.vertices && imgSize.scale > 0 && !selecting && (
     <svg width={imgSize.w} height={imgSize.h} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      <polygon points={polygonPoints} fill="rgba(255,0,0,0.12)" stroke="red" strokeWidth="2" />
     </svg>
    )}

    {hasDraw && (
     <div
      style={{
       position: 'absolute',
       left: drawRect.x0,
       top: drawRect.y0,
       width: drawRect.w,
       height: drawRect.h,
       background: selecting ? 'rgba(0,128,255,0.2)' : 'rgba(255,0,0,0.12)',
       border: `2px solid ${selecting ? '#0080ff' : 'red'}`,
       pointerEvents: 'none',
      }}
     />
    )}
   </div>

   {/* 수동 추가 UI */}
   <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
    <input
     placeholder="수동 이름 입력"
     value={manualName}
     onChange={(e)=>setManualName(e.target.value)}
     style={{ width: 140 }}
    />
    <label>열</label>
    <select value={manualColumn} onChange={(e)=>setManualColumn(parseInt(e.target.value,10))}>
     {[2,3,4,5,6,7].map(c => <option key={c} value={c}>{c}</option>)}
    </select>
    <select value={addLeaveType} onChange={(e)=>setAddLeaveType(e.target.value)}>
     {['연가','조퇴','병가','특휴','교육','Unknown'].map(opt =>
      <option key={opt} value={opt}>{opt}</option>
     )}
    </select>
    <button onClick={commitAddManual}>수동 추가</button>
   </div>

   {selectedItem && (
    <div style={{ marginTop: 8, fontSize: 13, color: '#444' }}>
     <div>행/열: {selectedItem.row} / {selectedItem.column} · 교대: {selectedItem.shift}</div>
     <div>원문 추출: {selectedItem.raw_name}</div>
     <div style={{ marginTop: 6 }}>
      <img
       key={`${selectedItem.id}-${selectedItem.rev || 0}`}
       src={`${API_BASE}/review/sessions/${sessionId}/items/${selectedItem.id}/crop?v=${selectedItem.rev || 0}`}
       width={180}
       height="auto"
       alt="crop"
       onError={(e) => (e.currentTarget.style.display = 'none')}
      />
     </div>
    </div>
   )}
  </div>
 );
}

function ReviewTable({ sessionId, data, setData, selectedId, setSelectedId }) {
 const [filter, setFilter] = useState('UNRESOLVED'); // ALL | UNRESOLVED

 const items = (data?.items || []).filter((it) =>
  filter === 'UNRESOLVED' ? it.status === 'unresolved' : true
 );

 const resolved = (data?.items || []).filter((it) => it.status === 'resolved').length;
 const total = (data?.items || []).length;

 async function handleSelect(item, name) {
  try {
   const updated = await apiPatch(`/review/sessions/${sessionId}/items/${item.id}`, {
    selected: name
   });
   setData((prev) => ({
    ...prev,
    items: prev.items.map((it) => (it.id === item.id ? updated : it))
   }));
  } catch (e) {
   alert(`저장 실패: ${e.message}`);
  }
 }

 return (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 560px', gap: 16 }}>
   <div>
    <div style={{ marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
     <strong>진행률: {resolved} / {total}</strong>
     <button onClick={() => setFilter('ALL')}>전체</button>
     <button onClick={() => setFilter('UNRESOLVED')}>미확정만</button>
    </div>

    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
     <thead>
      <tr>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>이미지</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>행/열</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>원문</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>후보/선택</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>교대</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>구분</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>삭제</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>초기화</th>
       <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>상태</th>
      </tr>
     </thead>
     <tbody>
      {items.map((item) => {
       const isSel = selectedId === item.id;
       return (
        <tr
         key={item.id}
         onClick={() => setSelectedId(item.id)}
         style={{ background: isSel ? '#fff7e6' : 'transparent', cursor: 'pointer' }}
        >
         <td style={{ padding: '6px 4px' }}>
          <img
            key={`${item.id}-${item.rev || 0}`}
            src={`${API_BASE}/review/sessions/${sessionId}/items/${item.id}/crop?v=${item.rev || 0}`}
            width={140}
            height="auto"
            alt="crop"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
         </td>
         <td>{item.row} / {item.column}</td>
         <td>{item.raw_name}</td>
         <td>
          <CandidateRadios item={item} onSelect={(name) => handleSelect(item, name)} />
         </td>
         <td>{item.shift}</td>
         <td>
            <select
            value={item.leave_type || 'Unknown'}
            onChange={async (e) => {
            const v = e.target.value;
            try {
            const updated = await apiPatch(`/review/sessions/${sessionId}/items/${item.id}`, { leave_type: v });
            setData(prev => ({
            ...prev,
            items: prev.items.map(it => it.id === item.id ? updated : it)
            }));
            } catch (err) {
            alert(`종류 변경 실패: ${err.message}`);
            }
            }}
            >
            {['연가','조퇴','병가','특휴','교육','Unknown'].map(opt => (
            <option key={opt} value={opt}>{opt}</option>
            ))}
            </select>
         </td>
         <td style={{ whiteSpace: 'nowrap' }}>
        <button
        onClick={async (e) => {
        e.stopPropagation();
        if (!confirm('이 항목을 삭제할까요?')) return;
        try {
            await apiDelete(`/review/sessions/${sessionId}/items/${item.id}`);
            setData(prev => {
            const nextItems = prev.items.filter(it => it.id !== item.id);
            return { ...prev, items: nextItems };
            });
            // 현재 선택이 삭제된 항목이면 다른 항목으로 이동
            if (selectedId === item.id) {
            const next = (data?.items || []).find(x => x.id !== item.id);
            setSelectedId(next ? next.id : null);
            }
        } catch (err) {
            alert(`삭제 실패: ${err.message}`);
        }
        }}
        style={{ color: '#b00020' }}
        >
        삭제
        </button>
        </td>
        <td>
        <button
        onClick={async (e) => {
        e.stopPropagation();
        try {
        const updated = await apiPost(`/review/sessions/${sessionId}/items/${item.id}/clear`, {});
        setData(prev => ({
            ...prev,
            items: prev.items.map(it => it.id === item.id ? updated : it)
        }));
        } catch (err) {
        alert(`초기화 실패: ${err.message}`);
        }
        }}
        >
        초기화
        </button>
        </td>
         <td>{item.status}</td>
        </tr>
       );
      })}
     </tbody>
    </table>
   </div>

   {/* 오른쪽 전체 이미지 + 재OCR 패널. data에서 selectedId로 선택 아이템을 찾습니다. */}
   <ReviewPreview
        sessionId={sessionId}
        data={data}
        selectedItem={(data?.items || []).find((x) => x.id === selectedId)}
        onReOCRDone={(updatedOrCreated) => {
        setData((prev) => {
        const exists = prev.items.some(it => it.id === updatedOrCreated.id);
   return exists
    ? { ...prev, items: prev.items.map(it => it.id === updatedOrCreated.id ? updatedOrCreated : it) }
    : { ...prev, items: [...prev.items, updatedOrCreated] };
  });
 }}
/>
  </div>
 );
}

function App() {
 const [step, setStep] = useState('SELECT'); // SELECT | REVIEW
 const [selectedImage, setSelectedImage] = useState(null);
 const [imageUrl, setImageUrl] = useState(null);

 const canvasRef = useRef(null);
 const [corners, setCorners] = useState([]);

 // 리뷰 세션 상태
 const [sessionId, setSessionId] = useState(null);
 const [sessionData, setSessionData] = useState(null);
 const [loadingSession, setLoadingSession] = useState(false);
 const [selectedId, setSelectedId] = useState(null);

 // 이미지가 로드되면 캔버스에 그리기
 useEffect(() => {
  if (imageUrl && canvasRef.current) {
   const canvasElement = canvasRef.current;
   const ctx = canvasElement.getContext('2d');
   const img = new Image();

   img.onload = () => {
    // 고정 표시 크기
    //const displayWidth = 1050;
    //const displayHeight = 1400;

    // 실제 이미지 크기
    //const actualWidth = img.width;
    //const actualHeight = img.height;

    // 비율 계산
    //const scaleX = actualWidth / displayWidth;
    //const scaleY = actualHeight / displayHeight;

    // Canvas 크기 설정
    //canvasElement.width = displayWidth;
    //canvasElement.height = displayHeight;

    // 이미지 그리기 (축소/확대)
    //ctx.clearRect(0, 0, displayWidth, displayHeight);
    //ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;

    // 내부 좌표 = 실제 이미지 픽셀 좌표
    canvasElement.width = natW;
    canvasElement.height = natH;

    // 화면은 반응형으로 축소(내부 좌표엔 영향 없음)
    canvasElement.style.width = '100%';
    canvasElement.style.height = 'auto';

    const ctx = canvasElement.getContext('2d');
    ctx.clearRect(0, 0, natW, natH);
    ctx.drawImage(img, 0, 0, natW, natH);

    // 이미 찍어둔 점 다시 그리기
    ctx.fillStyle = 'red';
    for (const c of corners) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 7, 0, 2 * Math.PI);
    ctx.fill();
    }

    // 표시된 코너 다시 찍기
    //ctx.fillStyle = 'red';
    //for (const c of corners) {
     //ctx.beginPath();
     //ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI);
     //ctx.fill();
    //}

    // 비율 저장 (나중에 corners 변환용)
    //canvasElement.dataset.scaleX = scaleX;
    //canvasElement.dataset.scaleY = scaleY;
   };

   img.src = imageUrl;
  }
 }, [imageUrl, corners]);

 // 세션 로더
 useEffect(() => {
  if (!sessionId) return;
  setLoadingSession(true);
  apiGet(`/review/sessions/${sessionId}`)
   .then((data) => {
    setSessionData(data);
    // 처음 로드 시 첫 미확정 항목 자동 선택
    if (!selectedId && data?.items?.length) {
     const first = data.items.find(x => x.status === 'unresolved') || data.items[0];
     if (first) setSelectedId(first.id);
    }
   })
   .catch((e) => {
    console.error(e);
    alert('세션 로드 실패');
   })
   .finally(() => setLoadingSession(false));
 }, [sessionId]); // selectedId는 여기서 설정

 const handleImageUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
   setSelectedImage(file);
   const url = URL.createObjectURL(file);
   setImageUrl(url);
   setCorners([]); // 새 이미지 업로드 시 코너 초기화
   setStep('SELECT');
  }
 };

 const handleCanvasClick = (event) => {
  /* if (corners.length >= 4) return;
  const canvasElement = canvasRef.current;
  const rect = canvasElement.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const newCorners = [...corners, { x, y }];
  setCorners(newCorners);

  const ctx = canvasElement.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fill();
*/

  if (corners.length >= 4) return;
 const canvasElement = canvasRef.current;
 const rect = canvasElement.getBoundingClientRect();

 const scaleX = canvasElement.width / rect.width;  // 내부/외부 비율
 const scaleY = canvasElement.height / rect.height;

 const x = (event.clientX - rect.left) * scaleX;
 const y = (event.clientY - rect.top) * scaleY;

 const newCorners = [...corners, { x, y }];
 setCorners(newCorners);

 const ctx = canvasElement.getContext('2d');
 ctx.fillStyle = 'red';
 ctx.beginPath();
 ctx.arc(x, y, 7, 0, 2 * Math.PI); // 반지름 7
 ctx.fill();

 };

 const handleResetCorners = () => {
  const canvasElement = canvasRef.current;
  if (!canvasElement) return;
  setCorners([]);
  setImageUrl((prev) => `${prev}`); // onload 재실행 유도
 };

 const handleTransform = async () => {
 /* if (corners.length !== 4) {
   alert('네 모서리를 모두 선택해주세요');
   return;
  }

  const canvasElement = canvasRef.current;
  const scaleX = parseFloat(canvasElement.dataset.scaleX || '1');
  const scaleY = parseFloat(canvasElement.dataset.scaleY || '1');

  // 좌표 스케일링
  const scaledCorners = corners.map((c) => ({
   x: c.x * scaleX,
   y: c.y * scaleY
  }));

  try {
   // 1) 업로드
   const formData = new FormData();
   formData.append('file', selectedImage);

   const uploadRes = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData
   });

   const uploadData = await uploadRes.json();
   if (!uploadRes.ok) throw new Error(uploadData?.error || 'upload failed');
   const fileId = uploadData.fileId;

   // 2) 변환
   const convertRes = await fetch(`${API_BASE}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, corners: scaledCorners })
   });

   const convertData = await convertRes.json();
   if (!convertRes.ok) throw new Error(convertData?.error || 'convert failed');
   console.log('Convert result:', convertData);

   // 3) 리뷰 세션 생성
   const session = await apiPost('/review/sessions', { fileId });
   setSessionId(session.sessionId);
   setSelectedId(null); // 새 세션에 맞춰 초기화
   setStep('REVIEW');
  } catch (e) {
   console.error('Transform failed:', e);
   alert(`에러: ${e.message}`);
  }
*/
if (corners.length !== 4) {
  alert('네 모서리를 모두 선택해주세요');
  return;
 }

 try {
  // 1) 업로드
  const formData = new FormData();
  formData.append('file', selectedImage);
  const uploadRes = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadData?.error || 'upload failed');
  const fileId = uploadData.fileId;

  // 2) 변환(그대로 전송)
  const payloadCorners = corners.map(({x,y}) => ({ x: Math.round(x), y: Math.round(y) }));
  const convertRes = await fetch(`${API_BASE}/convert`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ fileId, corners: payloadCorners })
  });
  const convertData = await convertRes.json();
  if (!convertRes.ok) throw new Error(convertData?.error || 'convert failed');

  // 3) 세션 생성
  const session = await apiPost('/review/sessions', { fileId });
  setSessionId(session.sessionId);
  setSelectedId(null);
  setStep('REVIEW');
 } catch (e) {
  console.error('Transform failed:', e);
  alert(`에러: ${e.message}`);
 }
 };

 const finalizeSession = async () => {
 try {
  const r = await apiPost(`/review/sessions/${sessionId}/finalize`, {});
  alert(`최종 저장 완료!\n${r.finalPath}`);
 } catch (e) {
  alert(`최종 저장 실패: ${e.message}`);
 }
};

const runLLMFill = async () => {
 try {
  const r = await apiPost(`/review/sessions/${sessionId}/llm-fill`, {});
  if (r?.session) {
   setSessionData(r.session);
   // 첫 미확정 자동 선택 보정
   const first = (r.session.items || []).find(x => x.status === 'unresolved');
   if (first) setSelectedId(first.id);
  } else {
   alert('LLM 보정 결과가 비어있습니다.');
  }
 } catch (e) {
  alert(`LLM 보정 실패: ${e.message}`);
 }
};

 return (
  <div className="App" style={{ padding: 16 }}>
   <h1>근무상황부 OCR</h1>

   {/* STEP: 업로드/코너 선택 */}
   {step === 'SELECT' && (
    <div>
     <div style={{ marginBottom: 8 }}>
      <input
       type="file"
       accept="image/*"
       onChange={handleImageUpload}
      />
     </div>

     {imageUrl && (
      <div>
       <p>표의 네 모서리를 순서대로 클릭하세요 ({corners.length}/4)</p>
       <canvas
        ref={canvasRef}
        onPointerDown={handleCanvasClick}
        style={{ border: '1px solid black', cursor: 'crosshair', maxWidth: '100%' }}
       />

       <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {corners.length === 4 && (
         <button onClick={handleTransform}>
          변환 실행
         </button>
        )}
        <button onClick={handleResetCorners} disabled={corners.length === 0}>
         코너 다시 선택
        </button>
       </div>
      </div>
     )}
    </div>
   )}

   {/* STEP: 리뷰 */}
   {step === 'REVIEW' && (
    <div>
     <div style={{ marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>이름 검토</h2>
        <span style={{ color: '#666' }}>{sessionId}</span>
        <button onClick={runLLMFill}>LLM 보정(자동 채우기)</button>
        <button onClick={finalizeSession}>완료 저장</button>
        <button onClick={() => window.open(`${API_BASE}/review/sessions/${sessionId}/download`, '_blank')}>
        엑셀 다운로드
        </button>
        <button onClick={() => setStep('SELECT')}>← 돌아가기</button>
        </div>

     {loadingSession && <div>세션 로딩 중…</div>}
     {(!loadingSession && sessionData) && (
      <ReviewTable
       sessionId={sessionId}
       data={sessionData}
       setData={setSessionData}
       selectedId={selectedId}
       setSelectedId={setSelectedId}
      />
     )}
    </div>
   )}
  </div>
 );
}

export default App;