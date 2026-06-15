const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");
const db = require("../db");
const { randomUUID } = require("crypto");

// DB 행 → Google Calendar 호환 형식 변환
function toGCalFormat(row) {
  return {
    id: row.id,
    summary: row.summary,
    ...(row.location && { location: row.location }),
    ...(row.description && { description: row.description }),
    start: row.start_dt
      ? { dateTime: row.start_dt, timeZone: row.timezone }
      : { date: row.start_d },
    end: row.end_dt
      ? { dateTime: row.end_dt, timeZone: row.timezone }
      : { date: row.end_d },
  };
}

// ── 목록 조회 ──
router.get("/events", requireAuth, async (req, res) => {
  const { timeMin, timeMax } = req.query;
  try {
    let sql = "SELECT * FROM local_calendar_events WHERE user_id = ?";
    const params = [req.user.id];

    if (timeMin) {
      const minStr = new Date(timeMin).toISOString().slice(0, 10);
      sql += " AND (start_dt >= ? OR start_d >= ?)";
      params.push(minStr + "T00:00:00", minStr);
    }
    if (timeMax) {
      const maxStr = new Date(timeMax).toISOString().slice(0, 10);
      sql += " AND (start_dt <= ? OR start_d <= ?)";
      params.push(maxStr + "T23:59:59", maxStr);
    }
    sql += " ORDER BY COALESCE(start_dt, start_d)";

    const [rows] = await db.query(sql, params);
    res.json({ items: rows.map(toGCalFormat) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 일정 생성 ──
router.post("/events", requireAuth, async (req, res) => {
  const { summary, location, description, start, end } = req.body;
  if (!summary) return res.status(400).json({ error: "제목을 입력하세요" });

  const id = randomUUID();
  const tz = start.timeZone || "Asia/Seoul";

  try {
    await db.query(
      `INSERT INTO local_calendar_events
        (id, user_id, summary, location, description, start_dt, start_d, end_dt, end_d, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user.id, summary,
        location || null, description || null,
        start.dateTime || null, start.date || null,
        end.dateTime || null, end.date || null,
        tz,
      ]
    );
    const [rows] = await db.query(
      "SELECT * FROM local_calendar_events WHERE id = ?", [id]
    );
    res.json(toGCalFormat(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 일정 수정 ──
router.patch("/events/:id", requireAuth, async (req, res) => {
  const { summary, location, description, start, end } = req.body;
  try {
    const fields = [];
    const params = [];

    if (summary !== undefined) { fields.push("summary = ?"); params.push(summary); }
    if (location !== undefined) { fields.push("location = ?"); params.push(location || null); }
    if (description !== undefined) { fields.push("description = ?"); params.push(description || null); }
    if (start) {
      fields.push("start_dt = ?", "start_d = ?", "timezone = ?");
      params.push(start.dateTime || null, start.date || null, start.timeZone || "Asia/Seoul");
    }
    if (end) {
      fields.push("end_dt = ?", "end_d = ?");
      params.push(end.dateTime || null, end.date || null);
    }

    if (fields.length === 0) return res.status(400).json({ error: "수정할 내용이 없습니다" });

    params.push(req.params.id, req.user.id);
    await db.query(
      `UPDATE local_calendar_events SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      params
    );
    const [rows] = await db.query(
      "SELECT * FROM local_calendar_events WHERE id = ?", [req.params.id]
    );
    res.json(toGCalFormat(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 일정 삭제 ──
router.delete("/events/:id", requireAuth, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM local_calendar_events WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
