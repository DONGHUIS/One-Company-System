// ── 인증 / 공통 상태 ──
let gmailToken = sessionStorage.getItem("gmailToken") || null;
let currentUserName = sessionStorage.getItem("userName") || "익명";

if (!gmailToken) {
  location.replace("login.html");
}

function logout() {
  sessionStorage.removeItem("gmailToken");
  sessionStorage.removeItem("userName");
  location.replace("login.html");
}

async function fetchUserInfo() {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${gmailToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    currentUserName = data.name || data.email || "익명";
    sessionStorage.setItem("userName", currentUserName);
  } catch {}
}

function handleTokenExpired() {
  sessionStorage.removeItem("gmailToken");
  location.replace("login.html");
}
