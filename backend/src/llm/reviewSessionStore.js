const fs = require('fs');
const path = require('path');

const SESS_DIR = path.join(__dirname, '../../data/review-sessions');
if (!fs.existsSync(SESS_DIR)) fs.mkdirSync(SESS_DIR, { recursive: true });

function saveSession(session) {
 const p = path.join(SESS_DIR, `${session.id}.json`);
 fs.writeFileSync(p, JSON.stringify(session, null, 2), 'utf-8');
 return session;
}
function loadSession(id) {
 const p = path.join(SESS_DIR, `${id}.json`);
 if (!fs.existsSync(p)) return null;
 return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function updateItem(sessionId, itemId, patch) {
 const s = loadSession(sessionId);
 if (!s) throw new Error('Session not found');
 const idx = s.items.findIndex(x => x.id === itemId);
 if (idx < 0) throw new Error('Item not found');
 s.items[idx] = { ...s.items[idx], ...patch };
 saveSession(s);
 return s.items[idx];
}

module.exports = { saveSession, loadSession, updateItem };