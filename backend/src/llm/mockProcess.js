// src/llm/mockProcess.js
// 실제 LLM 호출 전 연습용 함수
// 나중에 imageBase64 받아 OpenAI 호출하는 코드로 교체
async function mockProcessTimesheet(imageBase64){
 // 1~2초 대기 (비동기 시뮬레이션)
 await new Promise(r=>setTimeout(r, 800));

 // 아주 간단한 더미 JSON (나중에 schema 기반으로 확장)
 return {
  employee_name: "미지정",
  sheet_title: "샘플 근무상황부",
  entries: [
   {
    date: "2025-01-01",
    start_time: "09:00",
    end_time: "18:00",
    break_minutes: 60,
    total_hours: 8
   }
  ],
  warnings: ["(Mock) 실제 LLM 호출 전입니다."]
 };
}

module.exports = { mockProcessTimesheet };