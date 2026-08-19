const router = require("express").Router();
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { aiLimiter } = require("../middleware/rateLimit");
const writeLog = require("../db/audit");
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function canEdit(user, authorId) {
  return user.id === authorId || ["admin", "ceo"].includes(user.role);
}

// 목록 조회 (검색, 날짜 범위, 카테고리 필터)
router.get("/", requireAuth, async (req, res) => {
  try {
    const { q, from, to, category } = req.query;
    let sql = `
      SELECT m.id, m.title, m.meeting_date, m.location, m.category,
             m.created_at, m.updated_at,
             u.name AS author_name, u.email AS author_email,
             GROUP_CONCAT(au.name ORDER BY au.name SEPARATOR ', ') AS attendee_names
      FROM meeting_minutes m
      JOIN users u ON m.author_id = u.id
      LEFT JOIN meeting_attendees ma ON ma.minute_id = m.id
      LEFT JOIN users au ON au.id = ma.user_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += " AND (m.title LIKE ? OR m.content LIKE ?)";
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      params.push(like, like);
    }
    if (from) { sql += " AND DATE(m.meeting_date) >= ?"; params.push(from); }
    if (to)   { sql += " AND DATE(m.meeting_date) <= ?"; params.push(to); }
    if (category) { sql += " AND m.category = ?"; params.push(category); }

    sql += " GROUP BY m.id ORDER BY m.meeting_date DESC LIMIT 200";

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 단건 상세 조회
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [[minute]] = await db.query(
      `SELECT m.*, u.name AS author_name, u.email AS author_email
       FROM meeting_minutes m
       JOIN users u ON m.author_id = u.id
       WHERE m.id = ?`,
      [req.params.id],
    );
    if (!minute) return res.status(404).json({ error: "회의록 없음" });

    const [attendees] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM meeting_attendees ma JOIN users u ON ma.user_id = u.id
       WHERE ma.minute_id = ?`,
      [req.params.id],
    );
    minute.attendees = attendees;
    res.json(minute);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 작성
router.post("/", requireAuth, async (req, res) => {
  try {
    const { title, content, meeting_date, location, category, attendee_ids } = req.body;
    if (!title?.trim() || !content?.trim() || !meeting_date)
      return res.status(400).json({ error: "제목, 내용, 회의일시는 필수입니다" });

    const [result] = await db.query(
      `INSERT INTO meeting_minutes (title, content, meeting_date, location, category, author_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        content.trim(),
        meeting_date,
        location?.trim() || null,
        category?.trim() || "일반",
        req.user.id,
      ],
    );
    const minuteId = result.insertId;

    if (Array.isArray(attendee_ids) && attendee_ids.length) {
      await db.query(
        `INSERT IGNORE INTO meeting_attendees (minute_id, user_id) VALUES ${attendee_ids.map(() => "(?,?)").join(",")}`,
        attendee_ids.flatMap((uid) => [minuteId, uid]),
      );
    }

    await writeLog(req.user.id, "minute_created", `minutes/${minuteId}`, { title: title.trim() });
    res.json({ id: minuteId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 수정
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const [[minute]] = await db.query(
      `SELECT author_id FROM meeting_minutes WHERE id = ?`,
      [req.params.id],
    );
    if (!minute) return res.status(404).json({ error: "회의록 없음" });
    if (!canEdit(req.user, minute.author_id))
      return res.status(403).json({ error: "수정 권한 없음" });

    const { title, content, meeting_date, location, category, attendee_ids } = req.body;
    if (!title?.trim() || !content?.trim() || !meeting_date)
      return res.status(400).json({ error: "제목, 내용, 회의일시는 필수입니다" });

    await db.query(
      `UPDATE meeting_minutes SET title=?, content=?, meeting_date=?, location=?, category=?
       WHERE id=?`,
      [
        title.trim(),
        content.trim(),
        meeting_date,
        location?.trim() || null,
        category?.trim() || "일반",
        req.params.id,
      ],
    );

    await db.query(`DELETE FROM meeting_attendees WHERE minute_id = ?`, [req.params.id]);
    if (Array.isArray(attendee_ids) && attendee_ids.length) {
      await db.query(
        `INSERT IGNORE INTO meeting_attendees (minute_id, user_id) VALUES ${attendee_ids.map(() => "(?,?)").join(",")}`,
        attendee_ids.flatMap((uid) => [req.params.id, uid]),
      );
    }

    await writeLog(req.user.id, "minute_updated", `minutes/${req.params.id}`, { title: title.trim() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 삭제
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const [[minute]] = await db.query(
      `SELECT author_id FROM meeting_minutes WHERE id = ?`,
      [req.params.id],
    );
    if (!minute) return res.status(404).json({ error: "회의록 없음" });
    if (!canEdit(req.user, minute.author_id))
      return res.status(403).json({ error: "삭제 권한 없음" });

    await db.query(`DELETE FROM meeting_minutes WHERE id = ?`, [req.params.id]);
    await writeLog(req.user.id, "minute_deleted", `minutes/${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI 요약
router.post("/:id/summarize", requireAuth, aiLimiter, async (req, res) => {
  try {
    const [[minute]] = await db.query(
      `SELECT title, content, meeting_date, location FROM meeting_minutes WHERE id = ?`,
      [req.params.id],
    );
    if (!minute) return res.status(404).json({ error: "회의록 없음" });

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: `다음 회의록을 한국어로 핵심만 4~6줄로 요약해줘. 번호나 불릿 없이 문장으로.\n\n제목: ${minute.title}\n회의일시: ${minute.meeting_date}\n장소: ${minute.location || "(없음)"}\n\n${minute.content}`,
        },
      ],
    });

    res.json({ summary: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 카테고리 목록
router.get("/meta/categories", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT category FROM meeting_minutes ORDER BY category`,
    );
    res.json(rows.map((r) => r.category));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
