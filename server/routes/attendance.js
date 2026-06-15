const router = require("express").Router();
const db = require("../db");

function getClientIp(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}

async function isOfficeIp(ip) {
  const [rows] = await db.query(
    "SELECT id FROM allowed_ips WHERE ip_address = ? AND deleted_at IS NULL AND status = 'approved'",
    [ip]
  );
  return rows.length > 0;
}

// 허용 IP 목록 (admin) — 삭제된 항목 포함 전체 반환
router.get("/allowed-ips", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const [rows] = await db.query(
    `SELECT ai.*, u.name AS creator_name, r.name AS restorer_name
     FROM allowed_ips ai
     JOIN users u ON ai.created_by = u.id
     LEFT JOIN users r ON ai.restored_by = r.id
     ORDER BY ai.created_at DESC`
  );
  res.json(rows);
});

// 허용 IP 추가
router.post("/allowed-ips", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const { ip_address, description } = req.body;
  if (!ip_address) return res.status(400).json({ error: "IP 주소 필요" });
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;
  if (!ipPattern.test(ip_address.trim()))
    return res.status(400).json({ error: "유효하지 않은 IP 형식" });
  const status = req.user.role === "ceo" ? "approved" : "pending";
  try {
    await db.query(
      "INSERT INTO allowed_ips (ip_address, description, created_by, status) VALUES (?,?,?,?)",
      [ip_address.trim(), description?.trim() || null, req.user.id, status]
    );
    res.json({ ok: true, status });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "이미 등록된 IP입니다" });
    res.status(500).json({ error: e.message });
  }
});

// IP 등록 승인 (ceo)
router.post("/allowed-ips/:id/approve", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (req.user.role !== "ceo") return res.status(403).json({ error: "대표이사만 승인할 수 있습니다" });
  await db.query("UPDATE allowed_ips SET status = 'approved' WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

// IP 등록 거절 (ceo) — 레코드 삭제
router.post("/allowed-ips/:id/reject", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (req.user.role !== "ceo") return res.status(403).json({ error: "대표이사만 거절할 수 있습니다" });
  await db.query("DELETE FROM allowed_ips WHERE id = ? AND status = 'pending'", [req.params.id]);
  res.json({ ok: true });
});

// 허용 IP 설명 수정
router.patch("/allowed-ips/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const { description } = req.body;
  if (description === undefined || description === null) return res.status(400).json({ error: "description 필요" });
  await db.query("UPDATE allowed_ips SET description = ? WHERE id = ?", [String(description).trim() || null, req.params.id]);
  res.json({ ok: true });
});

// 허용 IP 비활성화 (soft delete)
router.delete("/allowed-ips/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  await db.query("UPDATE allowed_ips SET deleted_at = NOW() WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

// 허용 IP 복구
router.post("/allowed-ips/:id/restore", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  await db.query("UPDATE allowed_ips SET deleted_at = NULL, restored_by = ? WHERE id = ?", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

// 직원 목록 (admin)
router.get("/users", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const [rows] = await db.query(
    "SELECT id, name, email FROM users WHERE is_guest = 0 ORDER BY name"
  );
  res.json(rows);
});

// 현재 접속 IP 조회
router.get("/my-ip", (req, res) => {
  res.json({ ip: getClientIp(req) });
});

// 오늘 현황 조회
router.get("/today", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  const [records] = await db.query(
    `SELECT * FROM attendance_records
     WHERE user_id = ? AND DATE(clock_time) = CURDATE()
     ORDER BY clock_time ASC`,
    [req.user.id]
  );
  const clientIp = getClientIp(req);
  const isOffice = await isOfficeIp(clientIp);
  res.json({ records, clientIp, isOffice });
});

// 출퇴근 처리
router.post("/clock", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  const { type, reason } = req.body;
  if (!["in", "out"].includes(type))
    return res.status(400).json({ error: "타입은 in 또는 out이어야 합니다" });

  const clientIp = getClientIp(req);
  const isOffice = await isOfficeIp(clientIp);

  if (isOffice) {
    await db.query(
      "INSERT INTO attendance_records (user_id, type, ip_address, status) VALUES (?,?,?,?)",
      [req.user.id, type, clientIp, "normal"]
    );
    return res.json({ ok: true, status: "normal" });
  }

  if (!reason?.trim()) {
    return res.status(403).json({ needsReason: true, clientIp });
  }

  const [reqResult] = await db.query(
    "INSERT INTO attendance_requests (user_id, type, reason, request_date) VALUES (?,?,?,CURDATE())",
    [req.user.id, type, reason.trim()]
  );
  await db.query(
    "INSERT INTO attendance_records (user_id, type, ip_address, status, request_id) VALUES (?,?,?,?,?)",
    [req.user.id, type, clientIp, "pending", reqResult.insertId]
  );
  return res.json({ ok: true, status: "pending" });
});

// 출퇴근 기록 조회 (본인 또는 관리자)
router.get("/records", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  const isAdmin = ["admin", "ceo"].includes(req.user.role);
  const { date, userId } = req.query;

  let query = `
    SELECT ar.*, u.name AS user_name,
      ateq.reason, ateq.status AS req_status
    FROM attendance_records ar
    JOIN users u ON ar.user_id = u.id
    LEFT JOIN attendance_requests ateq ON ar.request_id = ateq.id
    WHERE 1=1
  `;
  const params = [];

  if (!isAdmin) {
    query += " AND ar.user_id = ?";
    params.push(req.user.id);
  } else if (userId) {
    query += " AND ar.user_id = ?";
    params.push(Number(userId));
  }

  if (date) {
    query += " AND DATE(ar.clock_time) = ?";
    params.push(date);
  }

  query += " ORDER BY ar.clock_time DESC LIMIT 200";
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// 결재 신청 목록 (admin)
router.get("/requests", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const { status } = req.query;

  let query = `
    SELECT ateq.*, u.name AS user_name, u.email AS user_email,
      approver.name AS approver_name,
      ar.clock_time, ar.ip_address AS record_ip
    FROM attendance_requests ateq
    JOIN users u ON ateq.user_id = u.id
    LEFT JOIN users approver ON ateq.approver_id = approver.id
    LEFT JOIN attendance_records ar ON ar.request_id = ateq.id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    query += " AND ateq.status = ?";
    params.push(status);
  }
  query += " ORDER BY ateq.created_at DESC LIMIT 100";
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// 결재 처리 (admin)
router.put("/requests/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!["admin", "ceo"].includes(req.user.role)) return res.status(403).json({ error: "권한 없음" });
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "상태는 approved 또는 rejected여야 합니다" });
  await db.query(
    "UPDATE attendance_requests SET status=?, approver_id=?, approved_at=NOW() WHERE id=?",
    [status, req.user.id, req.params.id]
  );
  await db.query(
    "UPDATE attendance_records SET status=? WHERE request_id=?",
    [status, req.params.id]
  );
  res.json({ ok: true });
});

module.exports = router;
