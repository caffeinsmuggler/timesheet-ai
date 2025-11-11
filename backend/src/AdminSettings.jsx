// src/AdminSettings.jsx
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const ADMIN_TOKEN = localStorage.getItem('adminToken') || '';

async function adminGet(path) {
 const r = await fetch(`${API_BASE}${path}`, { headers: { 'x-admin-token': ADMIN_TOKEN } });
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}
async function adminPost(path, body) {
 const r = await fetch(`${API_BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
  body: JSON.stringify(body || {})
 });
 if (!r.ok) throw new Error(`${path} ${r.status}`);
 return r.json();
}

export default function AdminSettings() {
 const [dayText, setDayText] = useState('');
 const [nightText, setNightText] = useState('');
 const [geminiKey, setGeminiKey] = useState('');
 const [projectId, setProjectId] = useState('');
 const [adminTokenNew, setAdminTokenNew] = useState('');
 const [loadingEmp, setLoadingEmp] = useState(false);
 const [message, setMessage] = useState('');

 async function loadEmployees() {
  setLoadingEmp(true);
  try {
   const data = await adminGet('/admin/employees');
   setDayText(data.day_shift.join('\n'));
   setNightText(data.night_shift.join('\n'));
  } catch (e) {
   setMessage('직원 불러오기 실패');
  } finally {
   setLoadingEmp(false);
  }
 }

 async function saveEmployees() {
  try {
   const day_shift = dayText.split('\n').map(s=>s.trim()).filter(s=>s);
   const night_shift = nightText.split('\n').map(s=>s.trim()).filter(s=>s);
   const r = await adminPost('/admin/employees', { day_shift, night_shift });
   setMessage(`저장 완료 (주간:${r.counts.day} / 야간:${r.counts.night})`);
  } catch (e) {
   setMessage('저장 실패: ' + e.message);
  }
 }

 async function saveKeys() {
  try {
   const r = await adminPost('/admin/keys', {
    GEMINI_API_KEY: geminiKey || undefined,
    GOOGLE_PROJECT_ID: projectId || undefined,
    ADMIN_TOKEN_NEW: adminTokenNew || undefined
   });
   setMessage('키 업데이트 완료. 재시작 필요하면 PM2 명령 실행.');
   if (adminTokenNew) {
    localStorage.setItem('adminToken', adminTokenNew);
   }
  } catch (e) {
   setMessage('키 업데이트 실패: ' + e.message);
  }
 }

 async function uploadVisionKey(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${API_BASE}/admin/vision-key`, {
   method: 'POST',
   headers: { 'x-admin-token': ADMIN_TOKEN },
   body: fd
  });
  if (!r.ok) {
   setMessage('Vision 키 업로드 실패');
  } else {
   setMessage('Vision 키 업로드 성공');
  }
 }

 useEffect(() => { loadEmployees(); }, []);

 return (
  <div style={{ padding: 16, border: '1px solid #ddd', marginTop: 24 }}>
   <h3>관리자 설정</h3>
   <div style={{ fontSize:12, color:'#555' }}>관리 토큰: {ADMIN_TOKEN ? '설정됨' : '미설정'} </div>

   <section style={{ marginTop:16 }}>
    <h4>직원 목록</h4>
    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
     <div>
      <label>주간(day_shift)</label><br/>
      <textarea value={dayText} onChange={e=>setDayText(e.target.value)} rows={12} style={{ width:220 }} />
     </div>
     <div>
      <label>야간(night_shift)</label><br/>
      <textarea value={nightText} onChange={e=>setNightText(e.target.value)} rows={12} style={{ width:220 }} />
     </div>
    </div>
    <button disabled={loadingEmp} onClick={saveEmployees} style={{ marginTop:8 }}>직원 목록 저장</button>
   </section>

   <section style={{ marginTop:24 }}>
    <h4>API 키 교체</h4>
    <input placeholder="Gemini 키" value={geminiKey} onChange={e=>setGeminiKey(e.target.value)} style={{ width:260 }} /><br/>
    <input placeholder="Google Project ID" value={projectId} onChange={e=>setProjectId(e.target.value)} style={{ width:260, marginTop:6 }} /><br/>
    <input placeholder="새 Admin Token(선택)" value={adminTokenNew} onChange={e=>setAdminTokenNew(e.target.value)} style={{ width:260, marginTop:6 }} /><br/>
    <button onClick={saveKeys} style={{ marginTop:8 }}>키 저장</button>
   </section>

   <section style={{ marginTop:24 }}>
    <h4>Vision 서비스 계정 키 업로드</h4>
    <input type="file" accept="application/json" onChange={e=> e.target.files[0] && uploadVisionKey(e.target.files[0])} />
    <div style={{ fontSize:12, color:'#666', marginTop:4 }}>업로드 후 서버 내부 creds/vision.json 교체</div>
   </section>

   {message && <div style={{ marginTop:16, color:'#006600' }}>{message}</div>}
  </div>
 );
}