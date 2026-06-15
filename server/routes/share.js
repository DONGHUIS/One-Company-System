const router = require("express").Router();
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

// 공유 링크 생성 (로그인 필요)
router.post("/:id", requireAuth, async (req, res) => {
  const memoId = req.params.id;
  try {
    // 본인 메모인지 확인
    const [rows] = await db.query(
      `SELECT id FROM memos WHERE id=? AND user_id=? AND deleted_at IS NULL`,
      [memoId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "메모를 찾을 수 없습니다" });

    // 기존 공유 링크가 있으면 반환
    const [existing] = await db.query(
      `SELECT token FROM memo_shares WHERE memo_id=?`,
      [memoId]
    );
    if (existing.length) {
      return res.json({ token: existing[0].token });
    }

    // 새 토큰 생성
    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO memo_shares (memo_id, token) VALUES (?, ?)`,
      [memoId, token]
    );
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 공유 링크 삭제 (로그인 필요)
router.delete("/:id", requireAuth, async (req, res) => {
  const memoId = req.params.id;
  try {
    const [rows] = await db.query(
      `SELECT id FROM memos WHERE id=? AND user_id=? AND deleted_at IS NULL`,
      [memoId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "메모를 찾을 수 없습니다" });

    await db.query(`DELETE FROM memo_shares WHERE memo_id=?`, [memoId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 공유 메모 조회 (로그인 불필요)
router.get("/:token", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.title, m.content, m.tag, m.created_at, m.edited_at
       FROM memo_shares s
       JOIN memos m ON s.memo_id = m.id
       WHERE s.token=? AND m.deleted_at IS NULL`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: "공유된 메모를 찾을 수 없습니다" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
