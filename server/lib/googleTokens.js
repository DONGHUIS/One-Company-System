// Google OAuth 리프레시 토큰 저장·액세스 토큰 갱신.
//
// 배경: 액세스 토큰 수명은 약 1시간인데 세션은 9시간이라,
// 로그인 1시간 뒤부터 Gmail·Drive·캘린더 호출이 전부 401로 죽었다.
// 로그인 시 받은 리프레시 토큰을 users.google_refresh_token 에 암호화 저장하고,
// 만료가 임박하면 여기서 새 액세스 토큰으로 갱신한다.
//
// 리프레시 토큰은 사실상 계정 위임 자격증명이므로 평문으로 두지 않는다.
// AES-256-GCM, 키는 TOKEN_ENC_KEY(없으면 SESSION_SECRET)에서 유도한다.
// 키를 바꾸면 기존 토큰은 복호화에 실패하고(null 반환) 사용자는 재로그인만
// 하면 되므로, 키 교체가 장애로 이어지지는 않는다.

const crypto = require("crypto");
const db = require("../db");

let cachedKey = null;
function encKey() {
  if (!cachedKey) {
    const secret = process.env.TOKEN_ENC_KEY || process.env.SESSION_SECRET;
    if (!secret) throw new Error("TOKEN_ENC_KEY 또는 SESSION_SECRET 이 필요합니다");
    cachedKey = crypto.createHash("sha256").update(secret).digest();
  }
  return cachedKey;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}

function decrypt(payload) {
  try {
    const [v, iv, tag, data] = String(payload).split(".");
    if (v !== "v1") return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function saveRefreshToken(userId, refreshToken) {
  await db.query(`UPDATE users SET google_refresh_token=? WHERE id=?`, [
    encrypt(refreshToken),
    userId,
  ]);
}

async function clearRefreshToken(userId) {
  await db.query(`UPDATE users SET google_refresh_token=NULL WHERE id=?`, [
    userId,
  ]);
}

/**
 * 저장된 리프레시 토큰으로 새 액세스 토큰을 발급받는다.
 * @returns {{accessToken: string, expiresAt: number}|null}
 *   저장된 리프레시 토큰이 없으면(로컬 계정, 재로그인 전 사용자) null.
 * @throws 갱신 HTTP 호출이 실패하면 throw. invalid_grant(사용자가 접근을
 *   회수한 경우)는 저장 토큰을 지워 무의미한 재시도를 막는다.
 */
async function getFreshAccessToken(userId) {
  const [rows] = await db.query(
    `SELECT google_refresh_token FROM users WHERE id=?`,
    [userId],
  );
  const stored = rows[0]?.google_refresh_token;
  if (!stored) return null;
  const refreshToken = decrypt(stored);
  if (!refreshToken) return null; // 암호화 키가 바뀐 경우 → 재로그인 필요

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      await clearRefreshToken(userId).catch(() => {});
    }
    throw new Error(
      `Google 토큰 갱신 실패: ${data.error_description || data.error || res.status}`,
    );
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

// 세션의 액세스 토큰이 만료 임박이면 갱신해서 세션에 다시 넣는다.
// 갱신에 실패해도(리프레시 토큰 없음 등) 요청은 통과시킨다 —
// 그 경우 각 라우트가 종전처럼 Google API 의 401 을 그대로 돌려준다.
async function ensureGoogleToken(req, res, next) {
  try {
    const sessUser = req.session?.passport?.user;
    if (!req.user || !sessUser) return next();

    const expiresAt = Number(sessUser.tokenExpiresAt) || 0;
    if (req.user.accessToken && Date.now() < expiresAt - 60_000) return next();

    const fresh = await getFreshAccessToken(req.user.id).catch((e) => {
      console.warn(`토큰 갱신 실패 (user=${req.user.id}): ${e.message}`);
      return null;
    });
    if (!fresh) return next();

    req.user.accessToken = fresh.accessToken;
    sessUser.accessToken = fresh.accessToken;
    sessUser.tokenExpiresAt = fresh.expiresAt;
    req.session.save(() => next());
  } catch (e) {
    next(e);
  }
}

module.exports = {
  saveRefreshToken,
  clearRefreshToken,
  getFreshAccessToken,
  ensureGoogleToken,
};
