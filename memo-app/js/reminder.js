// ── 일정 알림 ──
const REMIND_MINUTES = [10, 5]; // 10분 전, 5분 전

function initReminders() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission();
  }

  cleanupOldReminderKeys();
  checkUpcomingEvents();
  setInterval(checkUpcomingEvents, 60 * 1000);
}

function checkUpcomingEvents() {
  if (Notification.permission !== "granted") return;
  if (!gcalEvents || gcalEvents.length === 0) return;

  const now = new Date();

  gcalEvents.forEach((e) => {
    if (!e.start.dateTime) return; // 종일 일정 건너뜀

    const startTime = new Date(e.start.dateTime);
    const diffMin = (startTime - now) / 60000;

    REMIND_MINUTES.forEach((minutes) => {
      // diffMin이 minutes-1 ~ minutes 사이일 때 알림 (1분 윈도우)
      if (diffMin >= minutes - 1 && diffMin < minutes) {
        const key = `reminded_${e.id}_${minutes}`;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, String(startTime.getTime()));
          showEventNotification(e, minutes);
        }
      }
    });
  });
}

function showEventNotification(e, minutesBefore) {
  const title = e.summary || "(제목 없음)";
  const time = new Date(e.start.dateTime).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const body = `${time} 시작${e.location ? "\n📍 " + e.location : ""}`;

  const n = new Notification(`🔔 ${minutesBefore}분 후 — ${title}`, {
    body,
    tag: `event_${e.id}_${minutesBefore}`,
    requireInteraction: false,
  });

  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// 지난 일정의 localStorage 키 정리
function cleanupOldReminderKeys() {
  const now = Date.now();
  Object.keys(localStorage)
    .filter((k) => k.startsWith("reminded_"))
    .forEach((k) => {
      const ts = Number(localStorage.getItem(k));
      if (ts && ts < now - 24 * 60 * 60 * 1000) {
        localStorage.removeItem(k);
      }
    });
}
