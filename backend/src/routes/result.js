const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
router.get('/candidates/:fileId', (req, res) => {
try {
const { fileId } = req.params;
const resultPath = path.join(__dirname, '../../results', `${fileId}.json`);

if (!fs.existsSync(resultPath)) {
return res.status(404).json({ error: 'result not found' });
}

const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));

// 후보 정보만 추출
const candidates = data.result?.refined?.entries || [];

res.json({
fileId,
originalName: data.originalName,
candidates: candidates.map(entry => ({
column: entry.column,
row: entry.row,
raw_name: entry.raw_name,
candidates: entry.candidates,
selected: entry.selected,
reasoning: entry.reasoning
}))
});

} catch (e) {
console.error(e);
res.status(500).json({ error: 'failed to read candidates' });
}
});