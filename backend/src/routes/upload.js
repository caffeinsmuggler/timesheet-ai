// src/routes/upload.js (기존 내용 변경)
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuid } = require('uuid');
const { saveFileRecord } = require('../store/files');

const upload = multer({
 dest: path.join(__dirname, '../../uploads'),
 limits: { fileSize: 10 * 1024 * 1024 },
 fileFilter: (req, file, cb) => {
  const allowed = ['.png','.jpg','.jpeg','.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if(!allowed.includes(ext)){
   return cb(new Error('Only image/pdf files allowed'));
  }
  cb(null, true);
 }
});

const router = express.Router();

router.post('/upload', upload.single('file'), (req,res)=>{
 if(!req.file){
  return res.status(400).json({ error: 'No file uploaded' });
 }
 const fileId = uuid();
 saveFileRecord(fileId, {
  path: req.file.path,
  originalName: req.file.originalname
 });
 res.json({
  message: 'File stored',
  fileId,
  originalName: req.file.originalname
 });
});

module.exports = router;