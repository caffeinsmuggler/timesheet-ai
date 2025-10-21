// src/lib/preprocessImage.js
const sharp = require('sharp');
/**
* 이미지 전처리: 손글씨 인식률 향상
* 1. Grayscale 변환
* 2. 대비 강화
* 3. 샤프닝
* 4. 이진화 (선택)
*/
async function preprocessImage(inputBuffer) {
try {
console.log('🖼️ Preprocessing image…');

// Step 1: Grayscale + Contrast Enhancement
let processed = sharp(inputBuffer)
.grayscale()
.normalise() // 히스토그램 정규화 (대비 향상)
.sharpen({ sigma: 1.5 }); // 샤프닝

// Step 2: 선택적 이진화 (임계값 조정 가능)
// processed = processed.threshold(128); // 주석 해제 시 활성화

// Step 3: JPEG 품질 최대화
const output = await processed
.jpeg({ quality: 95 })
.toBuffer();

console.log('✓ Preprocessing complete');
return output;

} catch (error) {
console.error('❌ Preprocessing failed:', error);
// 전처리 실패 시 원본 반환
return inputBuffer;
}
}
module.exports = { preprocessImage };

// 테스트용 코드(실제 서버에선 사용 안함)
if (require.main === module) {
const fs = require('fs');
const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'preprocessed.jpg';

if (!inputPath) {
console.error('Usage: node preprocessImage.js <input> [output]');
process.exit(1);
}

const buffer = fs.readFileSync(inputPath);
preprocessImage(buffer).then(result => {
fs.writeFileSync(outputPath, result);
console.log(`✓ Saved to ${outputPath}`);
});
}