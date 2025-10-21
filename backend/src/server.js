require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uploadRouter = require('./routes/upload');
const convertRouter = require('./routes/convert');
//const resultRouter = require('./routes/result'); // 추가
const reviewRoutes = require('./routes/reviewRoutes');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (req,res)=> res.json({ ok:true, time:new Date().toISOString() }));

app.use('/api', uploadRouter);
app.use('/api', convertRouter); // 추가
//app.use('/api', resultRouter); // 추가
app.use('/api/review', reviewRoutes);
app.use('/api/review-sessions/:sid/llm-fill', reviewRoutes);

app.use(cors());

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));