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
    gmailToken = user.hasGoogle;
    if (location.pathname.endsWith("index.html")) {
      history.replaceState(null, "", location.href.replace("index.html", ""));
    }
    return user;
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

// ── 비밀번호 변경 모달 ──
function openChangePwModal() {
  document.getElementById("cpwCurrent").value = "";
  document.getElementById("cpwNew").value = "";
  document.getElementById("cpwConfirm").value = "";
  const msg = document.getElementById("changePwMsg");
  msg.textContent = "";
  msg.className = "changepw-msg";
  const wMsg = document.getElementById("withdrawMsg");
  wMsg.textContent = "";
  wMsg.className = "changepw-msg";
  document.getElementById("changePwModal").style.display = "flex";
}

function closeChangePwModal(e) {
  if (e && e.target !== document.getElementById("changePwModal")) return;
  document.getElementById("changePwModal").style.display = "none";
}

async function submitChangePw() {
  const currentPassword = document.getElementById("cpwCurrent").value;
  const newPassword = document.getElementById("cpwNew").value;
  const confirm = document.getElementById("cpwConfirm").value;
  const msg = document.getElementById("changePwMsg");
  const btn = document.querySelector(".changepw-submit-btn");

  msg.className = "changepw-msg";
  if (!currentPassword || !newPassword || !confirm) {
    msg.className = "changepw-msg error";
    msg.textContent = "모든 항목을 입력하세요";
    return;
  }
  if (newPassword !== confirm) {
    msg.className = "changepw-msg error";
    msg.textContent = "새 비밀번호가 일치하지 않습니다";
    return;
  }

  btn.disabled = true;
  btn.textContent = "변경 중...";
  try {
    const res = await apiFetch("/auth/local/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.className = "changepw-msg error";
      msg.textContent = data.error || "변경 실패";
    } else {
      msg.className = "changepw-msg success";
      msg.textContent = "비밀번호가 변경되었습니다!";
      setTimeout(() => closeChangePwModal(), 1500);
    }
  } catch {
    msg.className = "changepw-msg error";
    msg.textContent = "서버 오류";
  } finally {
    btn.disabled = false;
    btn.textContent = "변경하기";
  }
}

async function confirmWithdraw() {
  const wMsg = document.getElementById("withdrawMsg");
  wMsg.className = "changepw-msg";

  if (!confirm("정말 탈퇴하시겠습니까?\n모든 데이터가 삭제되며 복구할 수 없습니다.")) return;

  try {
    const res = await apiFetch("/auth/local/withdraw", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      wMsg.className = "changepw-msg error";
      wMsg.textContent = data.error || "탈퇴 실패";
    } else {
      location.replace("./login.html");
    }
  } catch {
    wMsg.className = "changepw-msg error";
    wMsg.textContent = "서버 오류";
  }
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
