const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

// 테이블 자동 생성
db.query(`
  CREATE TABLE IF NOT EXISTS scheduled_emails (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    to_addr      TEXT NOT NULL,
    cc           TEXT,
    subject      TEXT,
    raw_mime     MEDIUMTEXT NOT NULL,
    thread_id    VARCHAR(200),
    scheduled_at DATETIME NOT NULL,
    status       ENUM('pending','sent','failed') DEFAULT 'pending',
    sent_at      DATETIME,
    error_msg    TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).catch((e) => console.error("scheduled_emails 테이블 생성 오류:", e.message));

// 예약 등록
router.post("/", requireAuth, async (req, res) => {
  const { to, cc, subject, raw, threadId, scheduledAt } = req.body;
  if (!to || !raw || !scheduledAt)
    return res.status(400).json({ error: "필수 값 누락" });

  const dt = new Date(scheduledAt);
  if (isNaN(dt) || dt <= new Date())
    return res.status(400).json({ error: "예약 시간은 현재 이후여야 합니다." });

  await db.query(
    `INSERT INTO scheduled_emails (user_id, to_addr, cc, subject, raw_mime, thread_id, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, to, cc || null, subject || null, raw, threadId || null, dt]
  );
  res.json({ ok: true });
});

// 목록 조회 (?status=pending|sent|failed|all)
router.get("/", requireAuth, async (req, res) => {
  const { status = "pending" } = req.query;
  const allowed = ["pending", "sent", "failed"];
  const where = allowed.includes(status)
    ? "user_id = ? AND status = ?"
    : "user_id = ?";
  const params = allowed.includes(status)
    ? [req.user.id, status]
    : [req.user.id];

  const [rows] = await db.query(
    `SELECT id, to_addr, cc, subject, scheduled_at, status, sent_at, error_msg
     FROM scheduled_emails
     WHERE ${where}
     ORDER BY scheduled_at DESC
     LIMIT 100`,
    params
  );
  res.json(rows);
});

// 단건 조회 (내용 포함)
router.get("/:id", requireAuth, async (req, res) => {
  const [[row]] = await db.query(
    `SELECT * FROM scheduled_emails WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: "없음" });

  // base64url → 원본 MIME 텍스트 디코딩
  const b64 = row.raw_mime.replace(/-/g, "+").replace(/_/g, "/");
  const mime = Buffer.from(b64, "base64").toString("utf-8");

  // 헤더 / 바디 분리
  const sep = mime.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
  const [headerPart, ...bodyParts] = mime.split(sep);
  const bodyRaw = bodyParts.join(sep);

  // 헤더 파싱
  const headers = {};
  let current = "";
  for (const line of headerPart.split(/\r?\n/)) {
    if (/^\s/.test(line)) { current += " " + line.trim(); continue; }
    if (current) {
      const idx = current.indexOf(":");
      if (idx > 0) headers[current.slice(0, idx).toLowerCase()] = current.slice(idx + 1).trim();
    }
    current = line;
  }
  if (current) {
    const idx = current.indexOf(":");
    if (idx > 0) headers[current.slice(0, idx).toLowerCase()] = current.slice(idx + 1).trim();
  }

  // Transfer-Encoding: base64 이면 바디 디코딩
  let body = bodyRaw;
  if ((headers["content-transfer-encoding"] || "").toLowerCase() === "base64") {
    body = Buffer.from(bodyRaw.replace(/\s/g, ""), "base64").toString("utf-8");
  }

  // quoted-printable 간단 디코딩
  if ((headers["content-transfer-encoding"] || "").toLowerCase() === "quoted-printable") {
    body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }

  res.json({
    id: row.id,
    subject: row.subject,
    to: row.to_addr,
    cc: row.cc,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    status: row.status,
    errorMsg: row.error_msg,
    contentType: headers["content-type"] || "text/plain",
    body,
  });
});

// 예약 취소
router.delete("/:id", requireAuth, async (req, res) => {
  const [result] = await db.query(
    `DELETE FROM scheduled_emails WHERE id = ? AND user_id = ? AND status = 'pending'`,
    [req.params.id, req.user.id]
  );
  if (result.affectedRows === 0)
    return res.status(404).json({ error: "취소할 수 없는 예약입니다." });
  res.json({ ok: true });
});

module.exports = router;
