// 로그인 여부 확인 미들웨어
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "로그인이 필요합니다" });
}

module.exports = { requireAuth };
