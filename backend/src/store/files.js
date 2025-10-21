// src/store/files.js
const files = new Map(); 
// key: fileId, value: { path, originalName, createdAt }
function saveFileRecord(id, info){
 if(!id || !info){
  throw new Error('saveFileRecord: id와 info가 필요합니다.');
 }
 files.set(id, { ...info, createdAt: Date.now() });
}
function getFileRecord(id){
 return files.get(id);
}
function deleteFileRecord(id){
 return files.delete(id);
}
function listFileIds(){
 return Array.from(files.keys());
}
module.exports = { saveFileRecord, getFileRecord, deleteFileRecord, listFileIds };