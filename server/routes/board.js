const express = require("express");
const router = express.Router();
const db = require("../db");
const writeLog = require("../db/audit");

function auth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  next();
}

function adminOnly(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "관리자만 가능합니다" });
  next();
}

// 게시글 목록
router.get("/posts", auth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT p.id, p.title, p.created_at, p.updated_at,
           u.name AS author_name, u.email AS author_email
    FROM posts p
    JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC
  `);
  res.json(rows);
});

// 게시글 단건
router.get("/posts/:id", auth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT p.*, u.name AS author_name, u.email AS author_email
    FROM posts p
    JOIN users u ON p.author_id = u.id
    WHERE p.id = ?
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "없는 게시글" });
  res.json(rows[0]);
});

// 게시글 작성 (관리자)
router.post("/posts", adminOnly, async (req, res) => {
  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: "제목과 내용을 입력하세요" });
  const [result] = await db.query(
    `INSERT INTO posts (title, content, author_id) VALUES (?, ?, ?)`,
    [title.trim(), content.trim(), req.user.id]
  );
  await writeLog(req.user.id, "post_created", `posts/${result.insertId}`, { title: title.trim() });
  res.json({ id: result.insertId });
});

// 게시글 수정 (관리자)
router.put("/posts/:id", adminOnly, async (req, res) => {
  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: "제목과 내용을 입력하세요" });
  await db.query(
    `UPDATE posts SET title=?, content=?, updated_at=NOW() WHERE id=?`,
    [title.trim(), content.trim(), req.params.id]
  );
  res.json({ ok: true });
});

// 게시글 삭제 (관리자)
router.delete("/posts/:id", adminOnly, async (req, res) => {
  await db.query(`DELETE FROM posts WHERE id=?`, [req.params.id]);
  await writeLog(req.user.id, "post_deleted", `posts/${req.params.id}`);
  res.json({ ok: true });
});

// 유저 목록 (관리자)
router.get("/users", adminOnly, async (req, res) => {
  const [rows] = await db.query(`SELECT id, name, email, role FROM users WHERE is_guest = 0 ORDER BY role DESC, id ASC`);
  res.json(rows);
});

// 유저 등급 변경
router.patch("/users/:id/role", adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!["ceo", "admin", "user"].includes(role)) return res.status(400).json({ error: "잘못된 등급" });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "본인 등급은 변경 불가" });
  if (role === "ceo" && req.user.role !== "ceo") return res.status(403).json({ error: "대표이사 등급은 대표이사만 부여할 수 있습니다" });

  const [[target]] = await db.query(`SELECT role FROM users WHERE id=?`, [req.params.id]);
  if (target?.role === "ceo" && req.user.role !== "ceo") return res.status(403).json({ error: "대표이사 등급은 대표이사만 변경할 수 있습니다" });

  await db.query(`UPDATE users SET role=? WHERE id=?`, [role, req.params.id]);
  await writeLog(req.user.id, "role_changed", `users/${req.params.id}`, {
    from: target?.role,
    to: role,
  });
  res.json({ ok: true });
});

// 사용자 행동 로그 조회 (관리자)
router.get("/audit-logs", adminOnly, async (req, res) => {
  const [rows] = await db.query(`
    SELECT a.id, a.action, a.target, a.detail, a.created_at,
           u.name AS user_name, u.email AS user_email
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

module.exports = router;
