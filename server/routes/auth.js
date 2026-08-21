const router = require("express").Router();
const passport = require("passport");
const bcrypt = require("bcrypt");
const db = require("../db");
const writeLog = require("../db/audit");
const { serverError } = require("../middleware/errors");
const { authLimiter } = require("../middleware/rateLimit");

// Google 로그인 시작
router.get("/google", passport.authenticate("google", {
  scope: [
    "profile",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/tasks",
  ],
  accessType: "offline",
  prompt: "consent",
}));

// Google 콜백
router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      const query = info === "domain_blocked" ? "?error=domain_blocked" : "";
      return res.redirect(`${process.env.FRONTEND_URL}/login.html${query}`);
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      req.session.save(() => res.redirect(`${process.env.FRONTEND_URL}/`));
    });
  })(req, res, next);
});

// 로그아웃
router.post("/logout", (req, res) => {
  const userId = req.user?.id ?? null;
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "로그아웃 실패" });
    writeLog(userId, "logout");
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

// ── 일반 회원가입 ──
router.post("/register", authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "이름, 이메일, 비밀번호를 모두 입력하세요" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)))
    return res.status(400).json({ error: "올바른 이메일 형식이 아닙니다" });
  if (password.length < 10)
    return res.status(400).json({ error: "비밀번호는 10자 이상이어야 합니다" });

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0)
      return res.status(409).json({ error: "이미 사용 중인 이메일입니다" });

    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (google_id, email, name, password) VALUES (NULL, ?, ?, ?)",
      [email, name, hashed]
    );
    const [[newUser]] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    const maskedEmail = email.replace(/^[^@]+/, (m) => "*".repeat(m.length));
    console.log(`일반 회원가입 완료: ${maskedEmail} (${name})`);
    await writeLog(newUser.id, "register", null, { method: "local" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 일반 로그인 ──
router.post("/local/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "이메일과 비밀번호를 입력하세요" });

  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ? AND password IS NOT NULL", [email]);
    if (!rows.length)
      return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });

    const maskedEmail = email.replace(/^[^@]+/, (m) => "*".repeat(m.length));
    console.log(`일반 로그인 성공: ${maskedEmail}`);
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: "로그인 실패" });
      writeLog(user.id, "login", null, { method: "local" });
      req.session.save(() => res.json({ ok: true }));
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 비밀번호 변경 ──
router.post("/local/change-password", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  if (!req.user.password) return res.status(400).json({ error: "Google 로그인 계정은 비밀번호를 변경할 수 없습니다" });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "현재 비밀번호와 새 비밀번호를 입력하세요" });
  // 가입 시 정책(10자 이상)과 동일하게 맞춘다.
  if (newPassword.length < 10)
    return res.status(400).json({ error: "새 비밀번호는 10자 이상이어야 합니다" });

  try {
    const match = await bcrypt.compare(currentPassword, req.user.password);
    if (!match) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);
    const maskedEmail = req.user.email.replace(/^[^@]+/, (m) => "*".repeat(m.length));
    console.log(`비밀번호 변경: ${maskedEmail}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 회원 탈퇴 ──
router.delete("/local/withdraw", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });

  try {
    const userId = req.user.id;
    const maskedEmail = req.user.email.replace(/^[^@]+/, (m) => "*".repeat(m.length));

    req.logout((err) => {
      if (err) return res.status(500).json({ error: "탈퇴 처리 중 오류" });
      req.session.destroy(async () => {
        res.clearCookie("connect.sid");
        await writeLog(userId, "withdraw");
        await db.query("DELETE FROM users WHERE id = ?", [userId]);
        console.log(`회원 탈퇴: ${maskedEmail}`);
        res.json({ ok: true });
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 현재 로그인 사용자 정보
router.get("/me", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "미로그인" });
  const [rows] = await db.query(`SELECT role FROM users WHERE id=?`, [req.user.id]).catch(() => [[]]);
  const role = rows[0]?.role || "user";
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    hasGoogle: !!req.user.accessToken,
    role,
  });
});

module.exports = router;
