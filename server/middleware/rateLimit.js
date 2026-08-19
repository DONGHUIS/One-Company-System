const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// 로그인 사용자는 user id 로, 미로그인 요청은 IP 로 집계한다.
// 사내망처럼 출구 IP 가 하나인 환경에서 IP 로만 묶으면
// 한 사람이 한도를 소진할 때 전원이 함께 막히기 때문이다.
const byUserOrIp = (req, res) =>
  req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip);

const makeLimiter = ({ windowMs, limit, message, ...rest }) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: byUserOrIp,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: message },
    ...rest,
  });

// Anthropic API 는 호출당 비용이 발생하므로 가장 좁게 잡는다.
const aiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: "AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});

// 업로드는 디스크·대역폭을 소모한다 (파일당 최대 20MB).
const uploadLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  message: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});

// 로그인·회원가입은 무차별 대입 대상이다. 미로그인 요청이라 IP 로 묶이는데,
// 사내망은 출구 IP 가 하나라 성공까지 세면 전 직원이 함께 막힌다.
// skipSuccessfulRequests 로 '실패한 시도'만 집계한다.
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  skipSuccessfulRequests: true,
});

// 게스트 참여는 비로그인 상태로 users 행을 만든다.
// 제한이 없으면 초대 링크 하나로 계정을 무한 생성할 수 있다.
const guestJoinLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: "참여 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});

module.exports = {
  aiLimiter,
  uploadLimiter,
  authLimiter,
  guestJoinLimiter,
};
