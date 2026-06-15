const router = require("express").Router();
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ExcelJS = require("exceljs");

// 메모 목록 조회
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, content, tag, edited_at, created_at
       FROM memos WHERE user_id=? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 메모 추가
router.post("/", requireAuth, async (req, res) => {
  const { title, content, tag } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO memos (user_id, title, content, tag) VALUES (?,?,?,?)`,
      [req.user.id, title, content, tag || "일반"]
    );
    const [rows] = await db.query(`SELECT * FROM memos WHERE id=?`, [result.insertId]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 메모 수정
router.put("/:id", requireAuth, async (req, res) => {
  const { title, content, tag } = req.body;
  try {
    await db.query(
      `UPDATE memos SET title=?, content=?, tag=?, edited_at=NOW()
       WHERE id=? AND user_id=?`,
      [title, content, tag || "일반", req.params.id, req.user.id]
    );
    const [rows] = await db.query(`SELECT * FROM memos WHERE id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "메모 없음" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 메모 휴지통으로 이동
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE memos SET deleted_at=NOW() WHERE id=? AND user_id=?`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 휴지통 목록
router.get("/trash", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, content, tag, deleted_at
       FROM memos WHERE user_id=? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 휴지통에서 복구
router.post("/trash/:id/restore", requireAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE memos SET deleted_at=NULL WHERE id=? AND user_id=?`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 영구 삭제
router.delete("/trash/:id", requireAuth, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM memos WHERE id=? AND user_id=? AND deleted_at IS NOT NULL`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 메모 엑셀 다운로드
router.get("/export/excel", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT title, content, tag, created_at, edited_at
       FROM memos WHERE user_id=? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = req.user.name || req.user.email;
    const sheet = workbook.addWorksheet("메모 목록");

    // 헤더 스타일
    sheet.columns = [
      { header: "제목",    key: "title",      width: 30 },
      { header: "내용",    key: "content",    width: 50 },
      { header: "태그",    key: "tag",        width: 12 },
      { header: "작성일",  key: "created_at", width: 20 },
      { header: "수정일",  key: "edited_at",  width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
      cell.font   = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 22;

    // 데이터 행
    rows.forEach((memo, i) => {
      const row = sheet.addRow({
        title:      memo.title,
        content:    memo.content,
        tag:        memo.tag,
        created_at: memo.created_at ? new Date(memo.created_at).toLocaleString("ko-KR") : "",
        edited_at:  memo.edited_at  ? new Date(memo.edited_at).toLocaleString("ko-KR")  : "",
      });
      if (i % 2 === 1) {
        row.eachCell(cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
        });
      }
      row.getCell("content").alignment = { wrapText: true };
    });

    const filename = encodeURIComponent(`메모_${new Date().toISOString().slice(0,10)}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
