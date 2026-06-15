const db = require("./index");

async function writeLog(userId, action, target = null, detail = null) {
  try {
    await db.query(
      "INSERT INTO audit_logs (user_id, action, target, detail) VALUES (?, ?, ?, ?)",
      [userId ?? null, action, target, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) {
    console.error("[audit] 로그 기록 실패:", e.message);
  }
}

module.exports = writeLog;
