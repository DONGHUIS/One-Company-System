// CSRF 방어와 공통 보안 헤더.
//
// 이 앱은 세션 쿠키로 인증한다. 브라우저는 다른 사이트에서 시작된 요청에도
// 쿠키를 자동으로 붙이므로, 방어가 없으면 외부 페이지가 로그인된 사용자
// 대신 탈퇴·권한변경·글삭제를 호출할 수 있다.
//
// 토큰 방식(csrf token)은 프런트의 모든 fetch 를 고쳐야 하므로,
// 브라우저가 상태 변경 요청에 반드시 붙이는 Origin 헤더를 검증한다.
// 세션 쿠키의 sameSite=lax 와 함께 이중으로 막는다.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** URL 문자열에서 origin(scheme://host:port)만 뽑는다. 실패하면 null. */
function toOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function csrfOriginCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Origin 이 없는 구형 클라이언트를 위해 Referer 도 본다.
  const origin = toOrigin(req.get("origin")) || toOrigin(req.get("referer"));

  // 브라우저는 GET 이 아닌 요청에 Origin 을 항상 붙인다.
  // 없다면 브라우저에서 온 요청이 아니므로 통과시키지 않는다.
  if (!origin) {
    console.warn(`출처 없는 상태변경 요청 차단: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: "허용되지 않은 요청입니다" });
  }

  // 자기 자신(호스트 헤더 기준)과 FRONTEND_URL 만 허용한다.
  const allowed = new Set(
    [
      toOrigin(process.env.FRONTEND_URL),
      `${req.protocol}://${req.get("host")}`,
    ].filter(Boolean),
  );

  if (!allowed.has(origin)) {
    console.warn(
      `교차 사이트 요청 차단: ${req.method} ${req.originalUrl} (origin=${origin})`,
    );
    return res.status(403).json({ error: "허용되지 않은 요청입니다" });
  }
  next();
}

// Content-Security-Policy 는 여기 넣지 않았다.
// 프런트에 onclick 등 인라인 핸들러가 200개 넘게 있어 script-src 에
// 'unsafe-inline' 을 열어야 하는데, 그러면 XSS 차단 효과가 거의 없다.
// 인라인 핸들러를 addEventListener 로 걷어낸 뒤 도입하는 게 맞다.
function securityHeaders(req, res, next) {
  // 업로드 파일이 선언된 타입과 다르게 해석되는 것을 막는다.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // 클릭재킹 방지 (메일 본문은 srcdoc iframe 이라 영향 없다).
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // 외부로 나갈 때 경로·쿼리를 흘리지 않는다.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), payment=(), geolocation=(self)",
  );
  next();
}

module.exports = { csrfOriginCheck, securityHeaders };
