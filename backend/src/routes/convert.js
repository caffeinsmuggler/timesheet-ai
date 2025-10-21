// src/routes/convert.js
const express = require('express');
const sharp = require('sharp');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { getFileRecord } = require('../store/files');
// const { processWithPipeline } = require('../llm/geminiPipeline');
const { processWithVisionPipeline } = require('../llm/visionPipeline');
const router = express.Router();

// [추가] 업로드 디렉토리 상수와 보장
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function runPythonTransform(imagePath, cornersPath, outputPath) {
	return new Promise((resolve, reject) => {
		const pythonScript = path.join(__dirname, '../python/perspective_transform.py');

		const pythonProcess = spawn('python', [
			pythonScript,
			imagePath,
			cornersPath,
			outputPath
		]);

		let error = '';
		pythonProcess.stderr.on('data', (data) => {
			error += data.toString();
		});

		pythonProcess.on('close', (code) => {
			if (code === 0) {
				resolve({ success: true, output: outputPath });
			} else {
				resolve({ success: false, error });
			}
		});

		pythonProcess.on('error', (err) => {
			resolve({ success: false, error: err.message });
		});
	});
}
router.post('/convert', async (req, res) => {
 try {
  const { fileId, corners } = req.body || {};
  if (!fileId || !corners) {
   return res.status(400).json({ error: 'fileId and corners required' });
  }

  const rec = getFileRecord(fileId);
  if (!rec) {
   return res.status(404).json({ error: 'file not found' });
  }

  const ext = path.extname(rec.originalName).toLowerCase();
  const mimeMap = {
   '.png': 'image/png',
   '.jpg': 'image/jpeg',
   '.jpeg': 'image/jpeg',
   '.pdf': 'application/pdf',
  };
  const mimeType = mimeMap[ext] || 'image/png';

  // 1) 코너 저장
  const cornersPath = path.join(UPLOADS_DIR, `${fileId}_corners.json`);
  fs.writeFileSync(cornersPath, JSON.stringify(corners), 'utf-8');
  console.log(`📝 Corners saved: ${cornersPath}`);

  // 2) 파이썬 투영변환
  const warpedPath = path.join(UPLOADS_DIR, `${fileId}_warped.jpg`);
  console.log('🔄 Step 1: Perspective transform with Python…');
  const transformResult = await runPythonTransform(rec.path, cornersPath, warpedPath);
  if (!transformResult.success) {
   console.error('❌ Python transform failed:', transformResult.error);
   return res.status(500).json({ error: 'Transform failed', details: transformResult.error });
  }

  // 3) Vision 파이프라인
  console.log('🔄 Step 2: Vision API extraction…');
  // [중요] 기존의 absWarpedPath = path.resolve(UPLOADS_DIR, …) 대신, 위에서 만든 warpedPath를 그대로 사용
  const absWarpedPath = path.resolve(warpedPath);

  // 워핑 이미지 메타
  const meta = await sharp(absWarpedPath).metadata();
  const warpedBase64 = fs.readFileSync(absWarpedPath).toString('base64');

  const result = await processWithVisionPipeline(warpedBase64, 'image/jpeg');

  // 4) details에 워핑 메타 주입
  result.details = {
   ...(result.details || {}),
   warped_image_path: absWarpedPath,
   warped_width: meta.width || null,
   warped_height: meta.height || null,
  };

  // 5) 결과 저장
  const responseData = {
   fileId,
   originalName: rec.originalName,
   processedAt: new Date().toISOString(),
   llmProvider: 'vision-local-matcher',
   result,
  };

  const resultsDir = path.join(__dirname, '../../results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const resultPath = path.join(resultsDir, `${fileId}.json`);
  fs.writeFileSync(resultPath, JSON.stringify(responseData, null, 2), 'utf-8');
  console.log(`✅ Warped image saved: ${transformResult.output}`);
  console.log(`✅ Result saved: ${resultPath}`);

  res.json(responseData);
 } catch (e) {
  console.error('❌ Convert error:', e);
  if (!res.headersSent) {
   res.status(500).json({
    error: 'processing failed',
    details: e.message,
   });
  }
 }
});
// [수정] GET /api/result/:fileId - 'info' 변수 버그 수정
router.get('/result/:fileId', (req, res) => {
 try {
  const { fileId } = req.params;
  const resultPath = path.join(__dirname, '../../results', `${fileId}.json`);
  if (!fs.existsSync(resultPath)) {
   return res.status(404).json({ error: 'result not found' });
  }
  const data = fs.readFileSync(resultPath, 'utf-8');
  res.json(JSON.parse(data)); // ← info → data로 수정
 } catch (e) {
  console.error(e);
  res.status(500).json({ error: 'failed to read result' });
 }
});

module.exports = router;