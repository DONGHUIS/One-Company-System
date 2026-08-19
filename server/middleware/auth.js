// 로그인 여부 확인 미들웨어
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "로그인이 필요합니다" });
}

// ── 게스트 계정 제한 ──
//
// 초대 링크로 이름만 입력하고 들어온 사용자(users.is_guest=1)도
// req.login() 으로 정회원과 똑같은 세션을 받는다. 아무 제한이 없으면
// 게시판·메모·출퇴근·리포트·AI 까지 전부 열리므로,
// 초대받은 채팅에 필요한 경로만 허용하고 나머지는 막는다.

const GUEST_ALLOWED = [
  /^\/api\/chat(\/|$)/,
  /^\/auth\/(me|logout)$/,
  /^\/uploads\//,
  /^\/api\/config$/,
  /^\/health$/,
];

// 채팅 안에서도 게스트에게 열어주면 안 되는 것들:
// 사내 주소록 조회와 새 대화방 개설. (초대받은 방에만 머물러야 한다)
const GUEST_DENIED = [
  /^\/api\/chat\/users\/?$/,
  /^\/api\/chat\/rooms\/direct(\/|$)/,
  /^\/api\/chat\/rooms\/group\/?$/,
];

function blockGuests(req, res, next) {
  if (!req.user?.is_guest) return next();

  const path = req.path;
  const allowed =
    GUEST_ALLOWED.some((re) => re.test(path)) &&
    !GUEST_DENIED.some((re) => re.test(path));

  // 방 멤버 추가도 게스트에게는 막는다 (주소록을 못 봐도 id 추측은 가능하다).
  const isMemberAdd =
    req.method === "POST" && /^\/api\/chat\/rooms\/[^/]+\/members\/?$/.test(path);

  if (allowed && !isMemberAdd) return next();
  return res
    .status(403)
    .json({ error: "게스트 계정으로는 사용할 수 없는 기능입니다" });
}

module.exports = { requireAuth, blockGuests };
