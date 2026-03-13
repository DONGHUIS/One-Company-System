// ── 오늘 요약 대시보드 ──
function initDashboard() {
  const h = new Date().getHours();
  const greeting = h < 6 ? "새벽에도 열심이시네요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "안녕하세요" : "오늘 하루 수고하셨어요";
  document.getElementById("dashGreeting").textContent = greeting;
  document.getElementById("dashName").textContent = currentUserName + "님";
  updateDashboardClock();
  setInterval(updateDashboardClock, 1000);
}

function updateDashboardClock() {
  const now = new Date();
  document.getElementById("dashClock").textContent =
    now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  document.getElementById("dashDateLabel").textContent =
    now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function updateDashboardTodayEvents() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const count = gcalEvents.filter(e => {
    const start = e.start?.date || e.start?.dateTime?.slice(0, 10);
    const end = e.end?.date || e.end?.dateTime?.slice(0, 10);
    if (!start) return false;
    if (end && end > todayStr && start <= todayStr) return true;
    return start === todayStr;
  }).length;
  document.getElementById("dashTodayEvents").textContent = count + "개";
}

async function fetchDashboardUnread() {
  try {
    const res = await apiFetch("/api/gmail/labels/INBOX");
    if (!res.ok) return;
    const data = await res.json();
    const unread = data.messagesUnread ?? 0;
    document.getElementById("dashUnread").textContent = unread + "개";
  } catch { /* 무시 */ }
}

async function fetchDashboardMemoCount() {
  try {
    const res = await apiFetch("/api/memos");
    if (!res.ok) return;
    const data = await res.json();
    const count = Array.isArray(data) ? data.length : 0;
    document.getElementById("dashUnreadIcon").textContent = "📝";
    document.getElementById("dashUnreadLabel").textContent = "내 메모";
    document.getElementById("dashUnread").textContent = count + "개";
  } catch { /* 무시 */ }
}
