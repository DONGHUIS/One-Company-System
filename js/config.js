// ── 서버 주소 ──
const SERVER_URL = "http://localhost:4000";

// ── 현재 사용자 상태 ──
let currentUserName = "익명";
let gmailToken = true; // 서버 세션으로 관리 (페이지 로드 시 checkAuth로 확인)

// ── 로그인 확인 ──
async function checkAuth() {
  try {
    const res = await fetch(`${SERVER_URL}/auth/me`, { credentials: "include" });
    if (!res.ok) {
      location.replace("./login.html");
      return false;
    }
    const user = await res.json();
    currentUserName = user.name || user.email || "익명";
    if (location.pathname.endsWith("index.html")) {
      history.replaceState(null, "", location.href.replace("index.html", ""));
    }
    return true;
  } catch {
    location.replace("./login.html");
    return false;
  }
}

function logout() {
  fetch(`${SERVER_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).finally(() => location.replace("./login.html"));
}

function handleTokenExpired() {
  location.replace("./login.html");
}

async function fetchUserInfo() {
  try {
    const res = await fetch(`${SERVER_URL}/auth/me`, { credentials: "include" });
    if (!res.ok) return;
    const user = await res.json();
    currentUserName = user.name || user.email || "익명";
  } catch {}
}

// ── 서버 API 호출 헬퍼 ──
async function apiFetch(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    handleTokenExpired();
    throw new Error("인증 만료");
  }
  return res;
}
