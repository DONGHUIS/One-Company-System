const router = require("express").Router();
const db = require("../db");

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "미로그인" });
}

// ── Heartbeat: 매 1분 호출 → 오늘 이용 시간 누적 ──
router.post("/activity", requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO activity_logs (user_id, log_date, minutes) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE minutes = minutes + 1`,
      [req.user.id, today]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/weekly", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 이번 주 월요일 ~ 일요일
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const fmt = d => d.toISOString().slice(0, 19).replace("T", " ");
    const fmtDate = d => d.toISOString().slice(0, 10);

    // 1. 내 이번 주 메모 수 + 이용 시간
    const [[myMemos]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM memos WHERE user_id=? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?`,
      [userId, fmt(monday), fmt(sunday)]
    );
    const [[myActivity]] = await db.query(
      `SELECT COALESCE(SUM(minutes), 0) AS total FROM activity_logs WHERE user_id=? AND log_date BETWEEN ? AND ?`,
      [userId, fmtDate(monday), fmtDate(sunday)]
    );

    // 2. 팀원별 활동 (메모 + 이용 시간)
    const [teamStats] = await db.query(
      `SELECT u.id, u.name, u.email,
        (SELECT COUNT(*) FROM memos m WHERE m.user_id=u.id AND m.deleted_at IS NULL AND m.created_at BETWEEN ? AND ?) AS memos,
        (SELECT COALESCE(SUM(minutes),0) FROM activity_logs al WHERE al.user_id=u.id AND al.log_date BETWEEN ? AND ?) AS minutes
       FROM users u
       ORDER BY minutes DESC, memos DESC`,
      [fmt(monday), fmt(sunday), fmtDate(monday), fmtDate(sunday)]
    );

    // 3. 요일별 내 활동 (메모 + 이용 시간)
    const [dailyMemos] = await db.query(
      `SELECT DAYOFWEEK(created_at) AS dow, COUNT(*) AS cnt
       FROM memos WHERE user_id=? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?
       GROUP BY dow`,
      [userId, fmt(monday), fmt(sunday)]
    );
    const [dailyActivity] = await db.query(
      `SELECT DAYOFWEEK(CONCAT(log_date, ' 00:00:00')) AS dow, SUM(minutes) AS cnt
       FROM activity_logs WHERE user_id=? AND log_date BETWEEN ? AND ?
       GROUP BY log_date`,
      [userId, fmtDate(monday), fmtDate(sunday)]
    );

    // DAYOFWEEK: 1=일,2=월...7=토 → 월(0)~일(6)
    const dowIdx = { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 1:6 };
    const daily = ["월","화","수","목","금","토","일"].map(label => ({ day: label, memos: 0, minutes: 0 }));
    dailyMemos.forEach(r => { daily[dowIdx[r.dow]].memos = r.cnt; });
    dailyActivity.forEach(r => { daily[dowIdx[r.dow]].minutes = r.cnt; });

    // 4. 이번 주 인기 태그
    const [topTags] = await db.query(
      `SELECT tag, COUNT(*) AS cnt FROM memos
       WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ?
       GROUP BY tag ORDER BY cnt DESC LIMIT 6`,
      [fmt(monday), fmt(sunday)]
    );

    res.json({
      myId: userId,
      myStats: { memos: myMemos.cnt, minutes: Number(myActivity.total) },
      teamStats,
      daily,
      topTags,
      weekRange: { start: fmtDate(monday), end: fmtDate(sunday) }
    });
  } catch (e) {
    console.error("리포트 오류:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
