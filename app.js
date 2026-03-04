function getMemos() {
  return JSON.parse(localStorage.getItem("memos")) || [];
}

function saveMemos(memos) {
  localStorage.setItem("memos", JSON.stringify(memos));
}

function getTrash() {
  return JSON.parse(localStorage.getItem("memoTrash")) || [];
}

function saveTrash(trash) {
  localStorage.setItem("memoTrash", JSON.stringify(trash));
}

function cleanupTrash() {
  const DAYS = 15;
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  saveTrash(getTrash().filter((m) => m.deletedAt > cutoff));
}

cleanupTrash();

function addMemo() {
  const title = document.getElementById("titleInput").value.trim();
  const content = document.getElementById("contentInput").value.trim();
  const tag = document.getElementById("tagInput").value.trim();

  if (!title && !content) return alert("내용을 입력하세요!");

  const memo = {
    id: Date.now(),
    title,
    content,
    tag: tag || "일반",
    author: currentUserName,
    date: new Date().toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  const memos = getMemos();
  memos.unshift(memo);
  saveMemos(memos);
  clearInputs();
  renderMemos();
}

function editMemo(id) {
  const memo = getMemos().find((m) => m.id === id);
  if (!memo) return;

  document.getElementById("titleInput").value = memo.title;
  document.getElementById("contentInput").value = memo.content;
  document.getElementById("tagInput").value = memo.tag;

  const btn = document.getElementById("addBtn");
  btn.innerHTML = `<span>수정 완료</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  btn.classList.add("edit-mode");
  btn.onclick = () => updateMemo(id);

  window.scrollTo({ top: 0, behavior: "smooth" });
}
//수정기능
function updateMemo(id) {
  const title = document.getElementById("titleInput").value.trim();
  const content = document.getElementById("contentInput").value.trim();
  const tag = document.getElementById("tagInput").value.trim();

  if (!title && !content) return alert("내용을 입력하세요!");

  const editedDate = new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const memos = getMemos().map((m) =>
    m.id === id ? { ...m, title, content, tag: tag || "일반", editedDate } : m,
  );
  saveMemos(memos);
  resetAddBtn();
  clearInputs();
  renderMemos();
}
//삭제 기능 (휴지통으로 이동)
function deleteMemo(id) {
  if (
    !confirm(
      "메모 삭제를 진행하시면 휴지통으로 이동하며 15일후 자동삭제가 진행됩니다.",
    )
  )
    return;
  const memos = getMemos();
  const target = memos.find((m) => m.id === id);
  if (!target) return;
  const trash = getTrash();
  trash.unshift({ ...target, deletedAt: Date.now() });
  saveTrash(trash);
  saveMemos(memos.filter((m) => m.id !== id));
  renderMemos();
}

function restoreMemo(id) {
  const trash = getTrash();
  const target = trash.find((m) => m.id === id);
  if (!target) return;
  const { deletedAt, ...memo } = target;
  const memos = getMemos();
  memos.unshift(memo);
  saveMemos(memos);
  saveTrash(trash.filter((m) => m.id !== id));
  toggleTrashView();
  renderMemos();
  updateTrashBadge();
}

function permanentDeleteMemo(id) {
  if (!confirm("영구 삭제하시면 복구할 수 없습니다.그래도 삭제진행하시나요?"))
    return;
  saveTrash(getTrash().filter((m) => m.id !== id));
  renderTrash();
  updateTrashBadge();
}

let trashViewOpen = false;

function toggleTrashView() {
  trashViewOpen = !trashViewOpen;
  document.getElementById("memoList").style.display = trashViewOpen
    ? "none"
    : "";
  document.getElementById("searchWrap").style.display = trashViewOpen
    ? "none"
    : "";
  document.getElementById("tagFilter").style.display = trashViewOpen
    ? "none"
    : "";
  document.getElementById("trashList").style.display = trashViewOpen
    ? ""
    : "none";
  document.getElementById("trashToggleBtn").textContent = trashViewOpen
    ? "← 메모로 돌아가기"
    : "🗑 휴지통";
  if (trashViewOpen) renderTrash();
}

function updateTrashBadge() {
  const count = getTrash().length;
  const btn = document.getElementById("trashToggleBtn");
  if (!trashViewOpen) {
    btn.textContent = count > 0 ? `🗑 휴지통 (${count})` : "🗑 휴지통";
  }
}

function renderTrash() {
  const trash = getTrash();
  const list = document.getElementById("trashList");
  const now = Date.now();
  const DAYS = 15;

  if (trash.length === 0) {
    list.innerHTML = `<div class="empty"><span class="empty-icon">🗑️</span>휴지통이 비어있습니다</div>`;
    return;
  }

  list.innerHTML = trash
    .map((m) => {
      const remaining = Math.ceil(
        (m.deletedAt + DAYS * 24 * 60 * 60 * 1000 - now) /
          (24 * 60 * 60 * 1000),
      );
      return `
    <div class="memo-card trash-card">
      <div class="memo-header">
        <h3>${m.title || "제목 없음"}</h3>
        <span class="trash-expire">${remaining}일 후 자동삭제</span>
      </div>
      <div class="memo-meta">
        <span class="tag"># ${m.tag}</span>
        <span class="author">✍️ ${m.author || "익명"}</span>
      </div>
      <p class="memo-content">${m.content}</p>
      <div class="memo-buttons">
        <button class="btn-restore" onclick="restoreMemo(${m.id})">↩ 복구</button>
        <button class="btn-del" onclick="permanentDeleteMemo(${m.id})">🗑 영구삭제</button>
      </div>
    </div>`;
    })
    .join("");
}

function resetAddBtn() {
  const btn = document.getElementById("addBtn");
  btn.innerHTML = `<span>추가</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
  btn.classList.remove("edit-mode");
  btn.onclick = addMemo;
}

function clearInputs() {
  ["titleInput", "contentInput", "tagInput"].forEach((id) => {
    document.getElementById(id).value = "";
  });
}

function updateTagFilter() {
  const memos = getMemos();
  const tags = ["전체", ...new Set(memos.map((m) => m.tag))];
  const current = document.getElementById("tagFilter").value;

  document.getElementById("tagFilter").innerHTML = tags
    .map(
      (t) =>
        `<option value="${t}" ${t === current ? "selected" : ""}>${t === "전체" ? "전체 태그" : t}</option>`,
    )
    .join("");
}

const MEMOS_PER_PAGE = 5;
let currentPage = 1;

function renderMemos() {
  const searchVal = document
    .getElementById("searchInput")
    .value.trim()
    .toLowerCase();
  const tagFilter = document.getElementById("tagFilter").value;

  let memos = getMemos();

  if (searchVal) {
    memos = memos.filter(
      (m) =>
        m.title.toLowerCase().includes(searchVal) ||
        m.content.toLowerCase().includes(searchVal) ||
        (m.author && m.author.toLowerCase().includes(searchVal)),
    );
  }

  if (tagFilter !== "전체") {
    memos = memos.filter((m) => m.tag === tagFilter);
  }

  const totalPages = Math.max(1, Math.ceil(memos.length / MEMOS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;

  const paged = memos.slice(
    (currentPage - 1) * MEMOS_PER_PAGE,
    currentPage * MEMOS_PER_PAGE,
  );
  const list = document.getElementById("memoList");

  if (memos.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <span class="empty-icon">🗒️</span>
        메모가 없습니다
      </div>`;
  } else {
    const cards = paged
      .map(
        (m) => `
      <div class="memo-card">
        <div class="memo-header">
          <h3>${m.title || "제목 없음"}</h3>
          <span class="memo-date">
            ${
              m.editedDate
                ? `${m.editedDate} <span class="memo-edited">(편집됨)</span>`
                : m.date
            }
          </span>
        </div>
        <div class="memo-meta">
          <span class="tag"># ${m.tag}</span>
          <span class="author">✍️ ${m.author || "익명"}</span>
        </div>
        <p class="memo-content">${m.content}</p>
        <div class="memo-buttons">
          <button class="btn-edit" onclick="editMemo(${m.id})">✏️ 수정</button>
          <button class="btn-del" onclick="deleteMemo(${m.id})">🗑 삭제</button>
        </div>
      </div>`,
      )
      .join("");

    const pagination =
      totalPages > 1
        ? `
      <div class="pagination">
        <button class="page-btn" onclick="changePage(-1)" ${currentPage === 1 ? "disabled" : ""}>&#8249;</button>
        <span class="page-info">${currentPage} / ${totalPages}</span>
        <button class="page-btn" onclick="changePage(1)" ${currentPage === totalPages ? "disabled" : ""}>&#8250;</button>
      </div>`
        : "";

    list.innerHTML = cards + pagination;
  }

  updateTagFilter();
}

function changePage(delta) {
  currentPage += delta;
  renderMemos();
}

document.getElementById("searchInput").addEventListener("input", () => {
  currentPage = 1;
  renderMemos();
});
document.getElementById("tagFilter").addEventListener("change", () => {
  currentPage = 1;
  renderMemos();
});

renderMemos();
updateTrashBadge();
document.getElementById("footerYear").textContent = new Date().getFullYear();

// 날씨 기능
const WMO_CODES = {
  0: { icon: "☀️", text: "맑음" },
  1: { icon: "🌤️", text: "대체로 맑음" },
  2: { icon: "⛅", text: "구름 조금" },
  3: { icon: "☁️", text: "흐림" },
  45: { icon: "🌫️", text: "안개" },
  48: { icon: "🌫️", text: "안개" },
  51: { icon: "🌦️", text: "이슬비" },
  53: { icon: "🌦️", text: "이슬비" },
  55: { icon: "🌦️", text: "이슬비" },
  61: { icon: "🌧️", text: "비" },
  63: { icon: "🌧️", text: "비" },
  65: { icon: "🌧️", text: "폭우" },
  71: { icon: "🌨️", text: "눈" },
  73: { icon: "🌨️", text: "눈" },
  75: { icon: "🌨️", text: "폭설" },
  77: { icon: "🌨️", text: "눈" },
  80: { icon: "🌧️", text: "소나기" },
  81: { icon: "🌧️", text: "소나기" },
  82: { icon: "🌧️", text: "강한 소나기" },
  85: { icon: "🌨️", text: "눈 소나기" },
  86: { icon: "🌨️", text: "눈 소나기" },
  95: { icon: "⛈️", text: "뇌우" },
  96: { icon: "⛈️", text: "뇌우" },
  99: { icon: "⛈️", text: "뇌우" },
};

function fetchWeather() {
  const el = document.getElementById("weatherContent");

  if (!navigator.geolocation) {
    el.textContent = "위치 정보 미지원";
    el.className = "weather-error";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const { latitude: lat, longitude: lon } = coords;
      try {
        const [weatherRes, geoRes] = await Promise.all([
          fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`,
          ),
          fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko`,
          ),
        ]);

        const { current_weather } = await weatherRes.json();
        const geoData = await geoRes.json();

        const { temperature, weathercode } = current_weather;
        const weather = WMO_CODES[weathercode] || {
          icon: "🌡️",
          text: "알 수 없음",
        };

        const addr = geoData.address;
        const city =
          addr.city ||
          addr.town ||
          addr.county ||
          addr.state ||
          "알 수 없는 위치";
        const district = addr.city_district || addr.suburb || "";
        const road = addr.road || "";
        const houseNumber = addr.house_number || "";
        const detailAddr = [city, district, road, houseNumber]
          .filter(Boolean)
          .join(" ");

        el.outerHTML = `
          <span class="weather-info" id="weatherContent">
            <span class="weather-icon">${weather.icon}</span>
            <span class="weather-temp">${Math.round(temperature)}°C</span>
            <span class="weather-desc">${weather.text}</span>
            <span class="weather-location">📍 ${detailAddr}</span>
          </span>`;
      } catch {
        el.textContent = "날씨 정보를 불러올 수 없습니다";
        el.className = "weather-error";
      }
    },
    () => {
      el.textContent = "위치 권한이 필요합니다";
      el.className = "weather-error";
    },
  );
}

fetchWeather();

// ── 일정 기능 (Google Calendar) ──
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedDate = null;
let gcalEvents = [];

function toDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function gcalEventDate(e) {
  return (e.start.dateTime || e.start.date).substring(0, 10);
}

function gcalEventTime(e) {
  if (!e.start.dateTime) return "종일";
  return new Date(e.start.dateTime).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventCoversDate(e, dateStr) {
  const start = (e.start.dateTime || e.start.date).substring(0, 10);
  const end = (e.end.dateTime || e.end.date).substring(0, 10);
  return e.end.date
    ? start <= dateStr && dateStr < end // 종일: end는 exclusive
    : start <= dateStr && dateStr <= end; // 시간: end는 inclusive 날짜
}

function renderCalendar() {
  const datesWithEvent = new Set(
    gcalEvents.flatMap((e) => {
      const start = (e.start.dateTime || e.start.date).substring(0, 10);
      const rawEnd = (e.end.dateTime || e.end.date).substring(0, 10);
      const end = e.end.date
        ? new Date(new Date(rawEnd) - 86400000).toISOString().substring(0, 10) // exclusive → inclusive
        : rawEnd;
      const dates = [];
      const cur = new Date(start);
      const last = new Date(end);
      while (cur <= last) {
        dates.push(cur.toISOString().substring(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    }),
  );
  document.getElementById("calTitle").textContent =
    `${calYear}년 ${calMonth + 1}월`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = toDateStr(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  let html = "";

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-cell empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toDateStr(calYear, calMonth, d);
    const dow = (firstDay + d - 1) % 7;
    let cls = "cal-cell";
    if (dateStr === todayStr) cls += " cal-today";
    if (dateStr === selectedDate) cls += " cal-selected";
    if (dow === 0) cls += " cal-sun";
    if (dow === 6) cls += " cal-sat";
    html += `<div class="${cls}" onclick="selectDate('${dateStr}')">
      <span>${d}</span>
      ${datesWithEvent.has(dateStr) ? '<span class="cal-dot"></span>' : ""}
    </div>`;
  }

  document.getElementById("calGrid").innerHTML = html;
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  document.getElementById("addScheduleForm").style.display = "none";
  renderCalendar();
  renderScheduleList();
  const [y, m, d] = dateStr.split("-");
  document.getElementById("selectedDateLabel").textContent =
    `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
  document.getElementById("btnAddSchedule").style.display = gmailToken
    ? "inline-block"
    : "none";
}

function renderScheduleList() {
  const list = document.getElementById("scheduleList");

  if (!gmailToken) {
    list.innerHTML = `<p class="schedule-empty">Google 로그인 후 일정을 불러옵니다</p>`;
    return;
  }

  if (selectedDate) {
    // 특정 날짜 일정
    const events = gcalEvents
      .filter((e) => eventCoversDate(e, selectedDate))
      .sort((a, b) =>
        (a.start.dateTime || a.start.date).localeCompare(
          b.start.dateTime || b.start.date,
        ),
      );

    list.innerHTML =
      events.length === 0
        ? `<p class="schedule-empty">등록된 일정이 없습니다</p>`
        : events
            .map(
              (e) => `
        <div class="schedule-item" onclick="showScheduleDetail('${e.id}')">
          <span class="schedule-time">${gcalEventTime(e)}</span>
          <div class="schedule-item-body">
            <span class="schedule-title">${e.summary || "(제목 없음)"}</span>
            ${e.location ? `<span class="schedule-location">📍 ${e.location}</span>` : ""}
          </div>
          ${e.htmlLink ? `<a class="schedule-gcal-link" href="${e.htmlLink}" target="_blank" rel="noopener" title="Google Calendar에서 열기" onclick="event.stopPropagation()">↗</a>` : ""}
          <button class="schedule-edit" onclick="event.stopPropagation(); editSchedule('${e.id}')" title="수정">✏️</button>
          <button class="schedule-del" onclick="event.stopPropagation(); deleteCalendarEvent('${e.id}')" title="삭제">×</button>
        </div>`,
            )
            .join("");
  } else {
    // 해당 월 전체 일정 (날짜별 그룹)
    const events = gcalEvents.sort((a, b) =>
      (a.start.dateTime || a.start.date).localeCompare(
        b.start.dateTime || b.start.date,
      ),
    );

    if (events.length === 0) {
      list.innerHTML = `<p class="schedule-empty">이번 달 일정이 없습니다</p>`;
      return;
    }

    const grouped = events.reduce((acc, e) => {
      const date = gcalEventDate(e);
      (acc[date] = acc[date] || []).push(e);
      return acc;
    }, {});

    list.innerHTML = Object.entries(grouped)
      .map(([date, items]) => {
        const [, m, d] = date.split("-");
        return `
        <div class="schedule-group">
          <div class="schedule-group-date">${parseInt(m)}월 ${parseInt(d)}일</div>
          ${items
            .map(
              (e) => `
            <div class="schedule-item" onclick="showScheduleDetail('${e.id}')">
              <span class="schedule-time">${gcalEventTime(e)}</span>
              <span class="schedule-title">${e.summary || "(제목 없음)"}</span>
              ${e.htmlLink ? `<a class="schedule-gcal-link" href="${e.htmlLink}" target="_blank" rel="noopener" title="Google Calendar에서 열기" onclick="event.stopPropagation()">↗</a>` : ""}
              <button class="schedule-edit" onclick="event.stopPropagation(); editSchedule('${e.id}')" title="수정">✏️</button>
              <button class="schedule-del" onclick="event.stopPropagation(); deleteCalendarEvent('${e.id}')" title="삭제">×</button>
            </div>`,
            )
            .join("")}
        </div>`;
      })
      .join("");
  }
}

let editingEventId = null;

function resetScheduleForm() {
  editingEventId = null;
  document.getElementById("scheduleTitle").value = "";
  document.getElementById("scheduleLocation").value = "";
  document.getElementById("scheduleStartHour").value = "";
  document.getElementById("scheduleStartMin").value = "00";
  document.getElementById("scheduleEndHour").value = "";
  document.getElementById("scheduleEndMin").value = "00";
  document.querySelector(".btn-save-schedule").textContent = "저장";
}

function toggleAddForm() {
  const form = document.getElementById("addScheduleForm");
  const show = form.style.display === "none";
  form.style.display = show ? "flex" : "none";
  if (show) {
    resetScheduleForm();
    document.getElementById("scheduleStartDate").value = selectedDate;
    document.getElementById("scheduleEndDate").value = selectedDate;
    document.getElementById("scheduleTitle").focus();
  }
}

function editSchedule(eventId) {
  const e = gcalEvents.find((ev) => ev.id === eventId);
  if (!e) return;

  editingEventId = eventId;

  document.getElementById("scheduleTitle").value = e.summary || "";
  document.getElementById("scheduleLocation").value = e.location || "";

  // 시작일
  const startDate = (e.start.dateTime || e.start.date).substring(0, 10);
  document.getElementById("scheduleStartDate").value = startDate;

  // 종료일 (종일 이벤트는 exclusive → 1일 뺌)
  let endDate;
  if (e.end.date) {
    const d = new Date(e.end.date);
    d.setDate(d.getDate() - 1);
    endDate = d.toISOString().substring(0, 10);
  } else {
    endDate = e.end.dateTime.substring(0, 10);
  }
  document.getElementById("scheduleEndDate").value = endDate;

  // 시작 시간
  if (e.start.dateTime) {
    const [sh, sm] = e.start.dateTime.substring(11, 16).split(":");
    document.getElementById("scheduleStartHour").value = parseInt(sh);
    document.getElementById("scheduleStartMin").value = sm;
  } else {
    document.getElementById("scheduleStartHour").value = "";
    document.getElementById("scheduleStartMin").value = "00";
  }

  // 종료 시간
  if (e.end.dateTime) {
    const [eh, em] = e.end.dateTime.substring(11, 16).split(":");
    document.getElementById("scheduleEndHour").value = parseInt(eh);
    document.getElementById("scheduleEndMin").value = em;
  } else {
    document.getElementById("scheduleEndHour").value = "";
    document.getElementById("scheduleEndMin").value = "00";
  }

  document.querySelector(".btn-save-schedule").textContent = "수정";
  document.getElementById("addScheduleForm").style.display = "flex";
  document
    .getElementById("addScheduleForm")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });

  // 상세 모달 닫기
  document.getElementById("scheduleDetailModal").style.display = "none";
}

function initTimeSelects() {
  ["scheduleStartHour", "scheduleEndHour"].forEach((id) => {
    document.getElementById(id).innerHTML =
      '<option value="">시</option>' +
      Array.from(
        { length: 24 },
        (_, i) => `<option value="${i}">${i}시</option>`,
      ).join("");
  });
  ["scheduleStartMin", "scheduleEndMin"].forEach((id) => {
    document.getElementById(id).innerHTML =
      '<option value="00">분</option>' +
      Array.from(
        { length: 12 },
        (_, i) =>
          `<option value="${String(i * 5).padStart(2, "0")}">${String(i * 5).padStart(2, "0")}분</option>`,
      ).join("");
  });
}

async function saveSchedule() {
  const title = document.getElementById("scheduleTitle").value.trim();
  const location = document.getElementById("scheduleLocation").value.trim();
  const startH = document.getElementById("scheduleStartHour").value;
  const startM = document.getElementById("scheduleStartMin").value;
  const endH = document.getElementById("scheduleEndHour").value;
  const endM = document.getElementById("scheduleEndMin").value;
  const startDateVal = document.getElementById("scheduleStartDate").value;
  const endDateVal = document.getElementById("scheduleEndDate").value;

  if (!title) return alert("일정 제목을 입력하세요!");
  if (!startDateVal) return alert("시작일을 선택하세요!");
  if (endDateVal && endDateVal < startDateVal)
    return alert("종료일이 시작일보다 이전일 수 없습니다.");

  const startDate = startDateVal;
  const endDate = endDateVal || startDateVal;
  const startTime =
    startH !== "" ? `${String(startH).padStart(2, "0")}:${startM}` : null;
  const endTime =
    endH !== "" ? `${String(endH).padStart(2, "0")}:${endM}` : null;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let eventBody;

  if (startTime) {
    const endDt = endTime
      ? `${endDate}T${endTime}:00`
      : (() => {
          const [h, m] = startTime.split(":").map(Number);
          const calcEndH = h + 1;
          if (calcEndH < 24) {
            return `${endDate}T${String(calcEndH).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
          }
          const next = new Date(endDate);
          next.setDate(next.getDate() + 1);
          const nd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
          return `${nd}T${String(calcEndH - 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
        })();
    eventBody = {
      summary: title,
      ...(location && { location }),
      start: { dateTime: `${startDate}T${startTime}:00`, timeZone: tz },
      end: { dateTime: endDt, timeZone: tz },
    };
  } else {
    // 시간 없으면 종일 이벤트 (종료일 다음날이 exclusive end)
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nd = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
    eventBody = {
      summary: title,
      ...(location && { location }),
      start: { date: startDate },
      end: { date: nd },
    };
  }

  try {
    const url = editingEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${editingEventId}`
      : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const res = await fetch(url, {
      method: editingEventId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${gmailToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    });
    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    if (!res.ok) {
      const err = await res.json();
      alert(
        (editingEventId ? "수정" : "저장") +
          " 실패: " +
          (err.error?.message || "알 수 없는 오류"),
      );
      return;
    }
    // 폼 초기화
    resetScheduleForm();
    document.getElementById("addScheduleForm").style.display = "none";
    await fetchCalendarEvents(calYear, calMonth);
  } catch {
    alert("네트워크 오류가 발생했습니다");
  }
}

function showScheduleDetail(eventId) {
  const e = gcalEvents.find((ev) => ev.id === eventId);
  if (!e) return;

  document.getElementById("sdmTitle").textContent = e.summary || "(제목 없음)";

  const timeStr = e.start.dateTime ? `${gcalEventTime(e)}` : "종일";

  const fmtDate = (raw) => {
    const d = new Date(raw);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  const startDateStr = fmtDate(e.start.dateTime || e.start.date);

  // 종일 이벤트의 end.date는 exclusive이므로 하루 뺌
  const endRaw =
    e.end.dateTime ||
    (() => {
      const d = new Date(e.end.date);
      d.setDate(d.getDate() - 1);
      return d.toISOString().substring(0, 10);
    })();
  const endDateStr = fmtDate(endRaw);

  const isMultiDay = startDateStr !== endDateStr;
  const dateStr = isMultiDay ? `${startDateStr} ~ ${endDateStr}` : startDateStr;

  const people = (e.attendees || []).filter((a) => !a.resource);
  const attendeeHtml = people.length
    ? `<div class="sdm-row">
        <span class="sdm-label">참석자</span>
        <ul class="sdm-attendees">
          ${people
            .map((a) => {
              const status =
                {
                  accepted: "✅",
                  declined: "❌",
                  tentative: "❓",
                  needsAction: "⏳",
                }[a.responseStatus] || "";
              return `<li>${status} ${a.displayName || a.email}</li>`;
            })
            .join("")}
        </ul>
      </div>`
    : "";

  document.getElementById("sdmBody").innerHTML = `
    <div class="sdm-row">
      <span class="sdm-label">날짜</span>
      <span>${dateStr} ${timeStr}</span>
    </div>
    ${e.location ? `<div class="sdm-row"><span class="sdm-label">장소</span><span>${e.location}</span></div>` : ""}
    ${e.description ? `<div class="sdm-row"><span class="sdm-label">설명</span><span class="sdm-desc">${e.description.replace(/\n/g, "<br>")}</span></div>` : ""}
    ${attendeeHtml}
    ${e.organizer ? `<div class="sdm-row"><span class="sdm-label">주최자</span><span>${e.organizer.displayName || e.organizer.email}</span></div>` : ""}
    <div class="sdm-actions">
      <button class="sdm-btn-edit" onclick="editSchedule('${e.id}')">✏️ 수정</button>
    </div>
  `;

  document.getElementById("scheduleDetailModal").style.display = "flex";
}

function closeScheduleDetail(e) {
  if (e && e.target !== document.getElementById("scheduleDetailModal")) return;
  document.getElementById("scheduleDetailModal").style.display = "none";
}

async function deleteCalendarEvent(eventId) {
  if (!confirm("이 일정을 삭제할까요?")) return;
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${gmailToken}` },
      },
    );
    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    if (res.ok || res.status === 204) {
      await fetchCalendarEvents(calYear, calMonth);
    }
  } catch {
    alert("삭제 중 오류가 발생했습니다");
  }
}

async function fetchCalendarEvents(year, month) {
  if (!gmailToken) return;
  const timeMin = encodeURIComponent(new Date(year, month, 1).toISOString());
  const timeMax = encodeURIComponent(
    new Date(year, month + 1, 0, 23, 59, 59).toISOString(),
  );
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
        `?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`,
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );
    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    const data = await res.json();
    gcalEvents = data.items || [];
    renderCalendar();
    renderScheduleList();
    updateDashboardTodayEvents();
  } catch {
    document.getElementById("scheduleList").innerHTML =
      `<p class="schedule-empty">일정을 불러올 수 없습니다</p>`;
  }
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  } else if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  selectedDate = null;
  gcalEvents = [];
  document.getElementById("selectedDateLabel").textContent =
    `${calYear}년 ${calMonth + 1}월 전체`;
  renderCalendar();
  renderScheduleList();
  fetchCalendarEvents(calYear, calMonth);
}

// ── Gmail + Drive 공통 ──
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

async function fetchEmails() {
  const status = document.getElementById("gmailStatus");
  const list = document.getElementById("gmailList");
  status.textContent = "메일 불러오는 중...";
  list.innerHTML = "";

  try {
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&labelIds=INBOX",
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );

    if (listRes.status === 401) {
      handleTokenExpired();
      return;
    }

    const { messages } = await listRes.json();
    if (!messages?.length) {
      status.textContent = "";
      list.innerHTML = `<p class="gmail-empty">받은 메일이 없습니다</p>`;
      return;
    }

    const details = await Promise.all(
      messages.map((m) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}` +
            `?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${gmailToken}` } },
        ).then((r) => r.json()),
      ),
    );

    status.textContent = `최근 ${details.length}개 메일`;
    fetchDashboardUnread();
    list.innerHTML = details
      .map((msg) => {
        const h = (name) =>
          msg.payload.headers.find((x) => x.name === name)?.value || "";
        const subject = h("Subject") || "(제목 없음)";
        const from =
          h("From")
            .replace(/<[^>]+>/, "")
            .replace(/"/g, "")
            .trim() || h("From");
        const dateStr = (() => {
          const d = new Date(h("Date"));
          return isNaN(d)
            ? h("Date")
            : d.toLocaleString("ko-KR", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
        })();
        const snippet = msg.snippet || "";
        const isUnread = msg.labelIds?.includes("UNREAD");

        return `
        <div class="gmail-item${isUnread ? " gmail-unread" : ""}" onclick="showEmailDetail('${msg.id}')">
          <div class="gmail-from">
            ${isUnread ? '<span class="gmail-unread-dot"></span>' : ""}
            ${from}
          </div>
          <div class="gmail-subject">${subject}</div>
          <div class="gmail-snippet">${snippet}</div>
          <div class="gmail-date">${dateStr}</div>
        </div>`;
      })
      .join("");
  } catch (e) {
    status.textContent = "메일을 불러올 수 없습니다";
  }
}

// ── 메일 상세 보기 ──
function getAttachmentsFromPart(part, result = []) {
  if (!part) return result;
  if (part.filename && part.body?.attachmentId) {
    result.push({
      filename: part.filename,
      mimeType: part.mimeType || "application/octet-stream",
      attachmentId: part.body.attachmentId,
      size: part.body.size || 0,
    });
  }
  if (part.parts) part.parts.forEach((p) => getAttachmentsFromPart(p, result));
  return result;
}

async function downloadAttachment(msgId, attachmentId, filename, mimeType) {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );
    const { data } = await res.json();
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert("첨부파일 다운로드 중 오류가 발생했습니다.");
  }
}

function getBodyFromPart(part) {
  // 재귀적으로 text/html → text/plain 순서로 본문 탐색
  if (!part) return null;
  if (part.mimeType === "text/html" && part.body?.data)
    return { type: "html", data: part.body.data };
  if (part.mimeType === "text/plain" && part.body?.data)
    return { type: "text", data: part.body.data };
  if (part.parts) {
    // html 우선
    for (const p of part.parts) {
      const found = getBodyFromPart(p);
      if (found?.type === "html") return found;
    }
    for (const p of part.parts) {
      const found = getBodyFromPart(p);
      if (found) return found;
    }
  }
  return null;
}

function base64urlDecode(str) {
  // base64url → base64 → decode
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  // UTF-8 처리
  return decodeURIComponent(
    [...bin]
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
}

async function showEmailDetail(msgId) {
  const modal = document.getElementById("emailModal");
  document.getElementById("emailModalSubject").textContent = "";
  document.getElementById("emailModalFrom").textContent = "";
  document.getElementById("emailModalDate").textContent = "";
  document.getElementById("emailModalBody").innerHTML =
    `<div class="email-modal-loading">메일 불러오는 중...</div>`;
  modal.style.display = "flex";

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );

    if (res.status === 401) {
      closeEmailModal();
      handleTokenExpired();
      return;
    }

    const msg = await res.json();
    const h = (name) =>
      msg.payload.headers.find((x) => x.name === name)?.value || "";

    const subject = h("Subject") || "(제목 없음)";
    const from =
      h("From")
        .replace(/<[^>]+>/, "")
        .replace(/"/g, "")
        .trim() || h("From");
    const dateStr = (() => {
      const d = new Date(h("Date"));
      return isNaN(d)
        ? h("Date")
        : d.toLocaleString("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
    })();

    document.getElementById("emailModalSubject").textContent = subject;
    document.getElementById("emailModalFrom").textContent =
      "보낸 사람: " + from;
    document.getElementById("emailModalDate").textContent = dateStr;

    // 답장/전달용 메타 저장
    const rawFrom = h("From");
    const fromEmail = (rawFrom.match(/<(.+?)>/) || [])[1] || rawFrom;
    const messageId = h("Message-ID");
    currentEmailMeta = {
      msgId,
      threadId: msg.threadId,
      messageId,
      subject,
      from: fromEmail,
      date: dateStr,
      bodyText: "", // bodyPart 파싱 후 채움
    };

    const bodyEl = document.getElementById("emailModalBody");

    // 첨부파일
    const attachments = getAttachmentsFromPart(msg.payload);
    const attArea = document.getElementById("emailModalAttachments");
    if (attachments.length) {
      attArea.innerHTML = `
        <div class="email-att-title">📎 첨부파일 ${attachments.length}개</div>
        <div class="email-att-list">
          ${attachments
            .map(
              (a) => `
            <button class="email-att-btn"
              data-msgid="${msgId}"
              data-attid="${a.attachmentId}"
              data-filename="${encodeURIComponent(a.filename)}"
              data-mimetype="${a.mimeType}"
              onclick="downloadAttachment(this.dataset.msgid, this.dataset.attid, decodeURIComponent(this.dataset.filename), this.dataset.mimetype)">
              📎 ${a.filename}
              <span class="email-att-size">${a.size ? Math.round(a.size / 1024) + "KB" : ""}</span>
            </button>`,
            )
            .join("")}
        </div>`;
      attArea.style.display = "";
    } else {
      attArea.innerHTML = "";
      attArea.style.display = "none";
    }

    const bodyPart = getBodyFromPart(msg.payload);

    if (bodyPart) {
      const decoded = base64urlDecode(bodyPart.data);
      currentEmailMeta.bodyText =
        bodyPart.type === "html"
          ? decoded
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .trim()
          : decoded;
      if (bodyPart.type === "html") {
        // iframe으로 격리하여 외부 CSS 영향 방지
        const iframe = document.createElement("iframe");
        iframe.sandbox = "allow-same-origin";
        iframe.style.cssText =
          "width:100%;border:none;min-height:300px;background:#fff;border-radius:8px;";
        iframe.srcdoc = decoded;
        bodyEl.innerHTML = "";
        bodyEl.appendChild(iframe);
        // 내용에 맞게 높이 조절
        iframe.onload = () => {
          iframe.style.height = iframe.contentDocument.body.scrollHeight + "px";
        };
      } else {
        bodyEl.innerHTML = `<pre>${decoded.replace(/</g, "&lt;")}</pre>`;
      }
    } else {
      bodyEl.innerHTML = `<p style="color:var(--text-muted)">(본문을 불러올 수 없습니다)</p>`;
    }
  } catch {
    document.getElementById("emailModalBody").innerHTML =
      `<p style="color:var(--danger)">메일을 불러오는 중 오류가 발생했습니다</p>`;
  }
}

// ── 서명 관리 ──
function getAllSignatures() {
  try {
    return JSON.parse(localStorage.getItem("emailSignatures")) || [];
  } catch {
    return [];
  }
}
function saveAllSignatures(sigs) {
  localStorage.setItem("emailSignatures", JSON.stringify(sigs));
}
function getDefaultSignature() {
  return getAllSignatures().find((s) => s.isDefault) || null;
}

function showSignatureModal() {
  renderSignatureList();
  document.getElementById("signatureModal").style.display = "flex";
}
function closeSignatureModal(e) {
  if (e && e.target !== document.getElementById("signatureModal")) return;
  document.getElementById("signatureModal").style.display = "none";
  cancelSigEdit();
}
function renderSignatureList() {
  const sigs = getAllSignatures();
  const list = document.getElementById("sigList");
  if (sigs.length === 0) {
    list.innerHTML = '<p class="sig-list-empty">등록된 서명이 없습니다</p>';
    return;
  }
  list.innerHTML = sigs
    .map(
      (s) => `
    <div class="sig-item">
      <div class="sig-item-header">
        <span class="sig-item-name">${s.name.replace(/</g, "&lt;")}${s.isDefault ? ' <span class="sig-default-badge">기본</span>' : ""}</span>
        <div class="sig-item-btns">
          ${!s.isDefault ? `<button class="sig-set-default-btn" onclick="setDefaultSignature('${s.id}')">기본으로</button>` : ""}
          <button class="sig-edit-btn" onclick="editSignature('${s.id}')">수정</button>
          <button class="sig-delete-btn" onclick="deleteSignature('${s.id}')">삭제</button>
        </div>
      </div>
      <div class="sig-item-preview">${s.content}</div>
    </div>`,
    )
    .join("");
}
function startAddSignature() {
  document.getElementById("sigEditId").value = "";
  document.getElementById("sigEditName").value = "";
  document.getElementById("sigEditContent").innerHTML = "";
  document.getElementById("sigEditArea").style.display = "block";
  document.getElementById("sigEditName").focus();
}
function editSignature(id) {
  const sig = getAllSignatures().find((s) => s.id === id);
  if (!sig) return;
  document.getElementById("sigEditId").value = sig.id;
  document.getElementById("sigEditName").value = sig.name;
  document.getElementById("sigEditContent").innerHTML = sig.content;
  document.getElementById("sigEditArea").style.display = "block";
  document.getElementById("sigEditName").focus();
}
function cancelSigEdit() {
  document.getElementById("sigEditArea").style.display = "none";
  document.getElementById("sigEditContent").innerHTML = "";
}
function saveSignature() {
  const id = document.getElementById("sigEditId").value;
  const name = document.getElementById("sigEditName").value.trim();
  const content = document.getElementById("sigEditContent").innerHTML;
  if (!name) return alert("서명 이름을 입력하세요.");
  const sigs = getAllSignatures();
  if (id) {
    const idx = sigs.findIndex((s) => s.id === id);
    if (idx >= 0) sigs[idx] = { ...sigs[idx], name, content };
  } else {
    sigs.push({
      id: Date.now().toString(),
      name,
      content,
      isDefault: sigs.length === 0,
    });
  }
  saveAllSignatures(sigs);
  cancelSigEdit();
  renderSignatureList();
  populateSignatureSelect();
}
function deleteSignature(id) {
  if (!confirm("이 서명을 삭제할까요?")) return;
  let sigs = getAllSignatures().filter((s) => s.id !== id);
  if (sigs.length > 0 && !sigs.some((s) => s.isDefault))
    sigs[0].isDefault = true;
  saveAllSignatures(sigs);
  renderSignatureList();
  populateSignatureSelect();
}
function setDefaultSignature(id) {
  saveAllSignatures(
    getAllSignatures().map((s) => ({ ...s, isDefault: s.id === id })),
  );
  renderSignatureList();
  populateSignatureSelect();
}

// ── 서명 편집기 툴바 ──
function sigFormat(cmd, val) {
  document.getElementById("sigEditContent").focus();
  document.execCommand(cmd, false, val || null);
  updateSigToolbar();
}
function sigInsertImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("sigEditContent").focus();
    document.execCommand(
      "insertHTML",
      false,
      `<img src="${e.target.result}" style="max-width:200px;height:auto;vertical-align:middle;" />`,
    );
    input.value = "";
  };
  reader.readAsDataURL(file);
}
function updateSigToolbar() {
  const active = (cmd) => document.queryCommandState(cmd);
  const set = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", on);
  };
  set("tbBold", active("bold"));
  set("tbItalic", active("italic"));
  set("tbUnderline", active("underline"));
}

// ── 컴포즈 서명 연동 ──
function populateSignatureSelect() {
  const sel = document.getElementById("composeSignatureSel");
  if (!sel) return;
  const prev = sel.value;
  const sigs = getAllSignatures();
  sel.innerHTML =
    '<option value="">서명 없음</option>' +
    sigs
      .map(
        (s) =>
          `<option value="${s.id}">${s.name.replace(/</g, "&lt;")}</option>`,
      )
      .join("");
  if (prev && sigs.some((s) => s.id === prev)) sel.value = prev;
}

function insertSignatureIntoCompose(sig) {
  const body = document.getElementById("composeBody");
  const existing = body.querySelector(".compose-sig-block");
  if (existing) existing.remove();

  currentComposeSignature = sig || null;

  if (sig) {
    const block = document.createElement("div");
    block.className = "compose-sig-block";
    block.setAttribute("contenteditable", "false");
    block.innerHTML = sig.content;
    body.appendChild(block);
  }
}

function onComposeSignatureChange() {
  const id = document.getElementById("composeSignatureSel").value;
  const sig = id ? getAllSignatures().find((s) => s.id === id) : null;
  insertSignatureIntoCompose(sig);
}

function applyDefaultSignatureToCompose() {
  currentComposeSignature = null;
  populateSignatureSelect();
  const def = getDefaultSignature();
  const sel = document.getElementById("composeSignatureSel");
  if (def) {
    sel.value = def.id;
    insertSignatureIntoCompose(def);
  } else {
    sel.value = "";
    insertSignatureIntoCompose(null);
  }
}

// ── 답장 / 전달 ──
let currentEmailMeta = null; // { msgId, threadId, subject, from, date, bodyText }
let composeFiles = [];
let currentComposeSignature = null; // 현재 컴포즈에 삽입된 서명 객체

// ── 본문 리치 텍스트 함수 ──
function composeBodyFormat(cmd, val) {
  document.getElementById("composeBody").focus();
  document.execCommand(cmd, false, val || null);
  updateComposeBodyToolbar();
}

function updateComposeBodyToolbar() {
  const active = (cmd) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const set = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", on);
  };
  set("cbBold", active("bold"));
  set("cbItalic", active("italic"));
  set("cbUnderline", active("underline"));
  set("cbStrike", active("strikeThrough"));
}

// 붙여넣기: 외부 HTML에서 스타일만 유지하고 불필요한 태그 제거
function handleComposePaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
}

function openCompose(mode) {
  if (!currentEmailMeta) return;
  const { subject, from, date, bodyText } = currentEmailMeta;

  const prefix = mode === "reply" ? "Re: " : "Fwd: ";
  const subjectVal =
    subject.startsWith("Re:") || subject.startsWith("Fwd:")
      ? subject
      : prefix + subject;

  document.getElementById("composeTo").value = mode === "reply" ? from : "";
  document.getElementById("composeCc").value = "";
  document.getElementById("composeSubject").value = subjectVal;

  const safe = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const label = mode === "reply" ? "원본 메일" : "전달된 메일";
  const quoteHtml =
    `<br><br><div style="border-left:3px solid #ccc;padding-left:10px;color:#555;margin-top:4px">` +
    `<span>---------- ${label} ----------</span><br>` +
    `보낸 사람: ${safe(from)}<br>날짜: ${date}<br>제목: ${safe(subject)}<br><br>` +
    `${safe(bodyText).replace(/\n/g, "<br>")}</div>`;

  currentComposeSignature = null;
  document.getElementById("composeBody").innerHTML = quoteHtml;
  applyDefaultSignatureToCompose();

  document.getElementById("emailComposeArea").style.display = "flex";
  document.getElementById("composeTo").focus();
}

function closeCompose() {
  document.getElementById("emailComposeArea").style.display = "none";
  document.getElementById("draftRestoreBar").style.display = "none";
  currentComposeSignature = null;
  composeFiles = [];
  renderAttachPreview();
}

// ── 임시저장 (다중) ──
function getAllDrafts() {
  try {
    return JSON.parse(localStorage.getItem("composeDrafts")) || [];
  } catch {
    return [];
  }
}
function saveAllDrafts(drafts) {
  localStorage.setItem("composeDrafts", JSON.stringify(drafts));
}
function saveDraftToStorage() {
  const drafts = getAllDrafts();
  drafts.unshift({
    id: Date.now().toString(),
    to: document.getElementById("composeTo").value,
    cc: document.getElementById("composeCc").value,
    subject: document.getElementById("composeSubject").value || "(제목 없음)",
    body: document.getElementById("composeBody").innerHTML,
    savedAt: Date.now(),
  });
  saveAllDrafts(drafts);
}
function deleteDraft(id) {
  saveAllDrafts(getAllDrafts().filter((d) => d.id !== id));
  renderDraftList();
  syncDraftRestoreBar();
}

function isComposeEmpty() {
  const bodyEl = document.getElementById("composeBody");
  const temp = document.createElement("div");
  temp.innerHTML = bodyEl.innerHTML;
  const sigBlock = temp.querySelector(".compose-sig-block");
  if (sigBlock) sigBlock.remove();
  return (
    !document.getElementById("composeTo").value.trim() &&
    !document.getElementById("composeCc").value.trim() &&
    !document.getElementById("composeSubject").value.trim() &&
    !(temp.innerText || "").trim() &&
    composeFiles.length === 0
  );
}

function tryCloseCompose() {
  if (isComposeEmpty()) {
    doCloseCompose(false);
  } else {
    document.getElementById("draftConfirmDialog").style.display = "flex";
  }
}

function hideDraftDialog() {
  document.getElementById("draftConfirmDialog").style.display = "none";
}

function doCloseCompose(saveDraft) {
  hideDraftDialog();
  if (saveDraft) saveDraftToStorage();
  if (currentEmailMeta === null) {
    closeEmailModal();
  } else {
    document.querySelector(".email-modal-actions").style.display = "";
    closeCompose();
  }
}

// 임시저장 복원 바 상태 동기화
function syncDraftRestoreBar() {
  const bar = document.getElementById("draftRestoreBar");
  if (!bar) return;
  const count = getAllDrafts().length;
  if (count > 0) {
    bar.querySelector("span").textContent = `💾 임시저장된 메일 ${count}개`;
    bar.style.display = "flex";
  } else {
    bar.style.display = "none";
  }
}

function restoreDraft() {
  showDraftListModal();
}

function dismissDraftBar() {
  document.getElementById("draftRestoreBar").style.display = "none";
}

// ── 임시저장함 목록 모달 ──
function showDraftListModal() {
  renderDraftList();
  document.getElementById("draftListModal").style.display = "flex";
}

function closeDraftListModal(e) {
  if (e && e.target !== document.getElementById("draftListModal")) return;
  document.getElementById("draftListModal").style.display = "none";
}

function renderDraftList() {
  const drafts = getAllDrafts();
  const content = document.getElementById("draftListContent");
  if (drafts.length === 0) {
    content.innerHTML =
      '<p class="draft-list-empty">임시저장된 메일이 없습니다</p>';
    return;
  }
  content.innerHTML = drafts
    .map((d) => {
      const dt = new Date(d.savedAt);
      const dateStr = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      const subject = d.subject || "(제목 없음)";
      const to = d.to || "(받는 사람 없음)";
      return `
      <div class="draft-list-item">
        <div class="draft-list-item-info">
          <span class="draft-list-subject">${subject.replace(/</g, "&lt;")}</span>
          <span class="draft-list-to">받는 사람: ${to.replace(/</g, "&lt;")}</span>
          <span class="draft-list-date">${dateStr}</span>
        </div>
        <div class="draft-list-item-btns">
          <button class="draft-open-btn" onclick="openDraft('${d.id}')">열기</button>
          <button class="draft-item-delete-btn" onclick="deleteDraft('${d.id}')">삭제</button>
        </div>
      </div>`;
    })
    .join("");
}

function openDraft(id) {
  const drafts = getAllDrafts();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return;
  // 열면 목록에서 제거 (열어서 편집 중인 상태)
  saveAllDrafts(drafts.filter((d) => d.id !== id));
  document.getElementById("draftListModal").style.display = "none";
  openNewCompose();
  document.getElementById("composeTo").value = draft.to || "";
  document.getElementById("composeCc").value = draft.cc || "";
  document.getElementById("composeSubject").value =
    draft.subject !== "(제목 없음)" ? draft.subject : "";
  document.getElementById("composeBody").innerHTML = draft.body || "";
  document.getElementById("draftRestoreBar").style.display = "none";
}

function openNewCompose() {
  currentEmailMeta = null;

  document.getElementById("emailModalSubject").textContent = "새 메일 작성";
  document.getElementById("emailModalFrom").textContent = "";
  document.getElementById("emailModalDate").textContent = "";
  document.getElementById("emailModalBody").innerHTML = "";
  document.getElementById("emailModalAttachments").innerHTML = "";
  document.getElementById("emailModalAttachments").style.display = "none";
  document.querySelector(".email-modal-actions").style.display = "none";

  // 컴포즈 필드 초기화
  document.getElementById("composeTo").value = "";
  document.getElementById("composeCc").value = "";
  document.getElementById("composeSubject").value = "";
  document.getElementById("composeBody").innerHTML = "";
  composeFiles = [];
  renderAttachPreview();

  applyDefaultSignatureToCompose();
  syncDraftRestoreBar();

  document.getElementById("emailComposeArea").style.display = "flex";
  document.getElementById("emailModal").style.display = "flex";
  document.getElementById("composeTo").focus();
}

function onAttachmentSelect() {
  const input = document.getElementById("composeAttachInput");
  composeFiles = [...composeFiles, ...Array.from(input.files)];
  input.value = "";
  renderAttachPreview();
}

function removeAttachment(idx) {
  composeFiles.splice(idx, 1);
  renderAttachPreview();
}

function renderAttachPreview() {
  const preview = document.getElementById("composeAttachPreview");
  if (!preview) return;
  preview.innerHTML = "";
  composeFiles.forEach((f, i) => {
    const tag = document.createElement("span");
    tag.className = "compose-attach-tag";
    tag.innerHTML = `📎 ${f.name} <button onclick="event.stopPropagation(); removeAttachment(${i})">×</button>`;
    preview.appendChild(tag);
  });
  preview.style.display = composeFiles.length ? "flex" : "none";
}

function onComposeDragOver(e) {
  e.preventDefault();
  document.getElementById("composeDropzone").classList.add("drag-over");
}

function onComposeDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.getElementById("composeDropzone").classList.remove("drag-over");
  }
}

function onComposeDrop(e) {
  e.preventDefault();
  document.getElementById("composeDropzone").classList.remove("drag-over");
  composeFiles = [...composeFiles, ...Array.from(e.dataTransfer.files)];
  renderAttachPreview();
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  return btoa(bytes.reduce((acc, b) => acc + String.fromCharCode(b), ""));
}

async function buildMimeRaw({ to, cc, subject, bodyHtml, messageId, files }) {
  const encSubject = "=?utf-8?b?" + utf8ToBase64(subject) + "?=";
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    `Subject: ${encSubject}`,
    messageId ? `In-Reply-To: ${messageId}` : "",
    messageId ? `References: ${messageId}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);

  // .compose-sig-block의 class/contenteditable 제거 후 인라인 스타일로 변환
  const temp = document.createElement("div");
  temp.innerHTML = bodyHtml || "";
  temp.querySelectorAll(".compose-sig-block").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("class");
    el.style.cssText =
      "margin-top:12px;padding-top:10px;border-top:1px solid #ddd;font-size:13px;";
  });
  const cleanHtml = temp.innerHTML;

  const html = `<html><body><div style="font-family:sans-serif;font-size:14px;line-height:1.6">${cleanHtml}</div></body></html>`;

  const bodyEncoded = utf8ToBase64(html);
  const bodyContentType = "text/html; charset=utf-8";

  let mime;
  if (!files || files.length === 0) {
    mime = [
      ...headers,
      `Content-Type: ${bodyContentType}`,
      "Content-Transfer-Encoding: base64",
      "",
      bodyEncoded,
    ].join("\r\n");
  } else {
    const boundary = "----=_Part_" + Date.now().toString(36);
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
      [
        `--${boundary}`,
        `Content-Type: ${bodyContentType}`,
        "Content-Transfer-Encoding: base64",
        "",
        bodyEncoded,
      ].join("\r\n"),
    ];
    for (const file of files) {
      const b64 = await fileToBase64(file);
      const encName = "=?utf-8?b?" + utf8ToBase64(file.name) + "?=";
      parts.push(
        [
          `--${boundary}`,
          `Content-Type: ${file.type || "application/octet-stream"}; name="${encName}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${encName}"`,
          "",
          b64,
        ].join("\r\n"),
      );
    }
    parts.push(`--${boundary}--`);
    mime = [...headers, "", parts.join("\r\n")].join("\r\n");
  }

  const rawBytes = new TextEncoder().encode(mime);
  return btoa(rawBytes.reduce((acc, b) => acc + String.fromCharCode(b), ""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendComposedEmail() {
  const to = document.getElementById("composeTo").value.trim();
  const cc = document.getElementById("composeCc").value.trim();
  const subject = document.getElementById("composeSubject").value.trim();
  const bodyHtml = document.getElementById("composeBody").innerHTML;

  if (!to) return alert("받는 사람 이메일을 입력하세요.");
  if (!subject) return alert("제목을 입력하세요.");

  const sendBtn = document.querySelector(".compose-send-btn");
  sendBtn.textContent = "전송 중...";
  sendBtn.disabled = true;

  try {
    const raw = await buildMimeRaw({
      to,
      cc,
      subject,
      bodyHtml,
      files: composeFiles,
      threadId: currentEmailMeta?.threadId,
      messageId: currentEmailMeta?.messageId,
    });

    const payload = { raw };
    if (currentEmailMeta?.threadId)
      payload.threadId = currentEmailMeta.threadId;

    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gmailToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    if (!res.ok) {
      const err = await res.json();
      alert("전송 실패: " + (err.error?.message || "알 수 없는 오류"));
      return;
    }

    closeCompose();
    closeEmailModal();
    alert("전송 완료!");
  } catch {
    alert("전송 중 오류가 발생했습니다.");
  } finally {
    sendBtn.textContent = "전송";
    sendBtn.disabled = false;
  }
}

function closeEmailModal(e) {
  if (e && e.target !== document.getElementById("emailModal")) return;
  document.getElementById("emailModal").style.display = "none";
  document.getElementById("emailModalBody").innerHTML = "";
  document.getElementById("emailModalAttachments").innerHTML = "";
  document.getElementById("emailModalAttachments").style.display = "none";
  document.querySelector(".email-modal-actions").style.display = "";
  closeCompose();
  currentEmailMeta = null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEmailModal();
});

// ── Drive 기능 ──
function driveFileIcon(mimeType) {
  if (mimeType === "application/vnd.google-apps.folder") return "📁";
  if (mimeType === "application/vnd.google-apps.document") return "📄";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "📊";
  if (mimeType === "application/vnd.google-apps.presentation") return "📑";
  if (mimeType === "application/vnd.google-apps.form") return "📋";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType.includes("video")) return "🎬";
  if (mimeType.includes("audio")) return "🎵";
  if (mimeType.includes("zip") || mimeType.includes("compress")) return "🗜️";
  return "📎";
}

function initDriveCard() {
  document.getElementById("driveStatus").textContent =
    "최근 파일을 불러오는 중...";
  document.getElementById("driveSearchBar").style.display = "flex";
  document.getElementById("driveRecentBtn").style.display = "inline-block";
  fetchRecentFiles();
}

let currentDriveFiles = [];

function renderDriveFiles(files) {
  currentDriveFiles = files || [];
  const list = document.getElementById("driveList");
  if (!currentDriveFiles.length) {
    list.innerHTML = `<p class="drive-empty">파일이 없습니다</p>`;
    return;
  }
  list.innerHTML = `<div class="drive-list">${currentDriveFiles
    .map((f, i) => {
      const icon = driveFileIcon(f.mimeType);
      const date = (() => {
        const d = new Date(f.modifiedTime);
        return isNaN(d)
          ? ""
          : d.toLocaleString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
      })();
      return `
      <div class="drive-item">
        <span class="drive-item-icon">${icon}</span>
        <div class="drive-item-info" onclick="openDrivePreview(${i})">
          <div class="drive-item-name" title="${f.name}">${f.name}</div>
          <div class="drive-item-date">${date}</div>
        </div>
        <div class="drive-item-actions">
          <button class="drive-preview-btn" onclick="openDrivePreview(${i})">미리보기</button>
          <a class="drive-open-link" href="${f.webViewLink}" target="_blank" rel="noopener">열기 ↗</a>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

// ── Drive 업로드 ──
let pendingUploadFiles = [];
let selectedFolderId = "root";
let folderNavStack = [{ id: "root", name: "내 드라이브" }];

function onDriveUploadSelect() {
  const input = document.getElementById("driveUploadInput");
  pendingUploadFiles = Array.from(input.files);
  input.value = "";
  if (pendingUploadFiles.length) openFolderPicker();
}

function onDriveDropzoneOver(e) {
  e.preventDefault();
  document.getElementById("driveDropzone").classList.add("drag-over");
}
function onDriveDropzoneLeave() {
  document.getElementById("driveDropzone").classList.remove("drag-over");
}
function onDriveDropzoneDrop(e) {
  e.preventDefault();
  document.getElementById("driveDropzone").classList.remove("drag-over");
  pendingUploadFiles = Array.from(e.dataTransfer.files);
  if (pendingUploadFiles.length) openFolderPicker();
}

// ── 폴더 피커 ──
function openFolderPicker() {
  folderNavStack = [{ id: "root", name: "내 드라이브" }];
  selectedFolderId = "root";
  document.getElementById("driveFolderModal").style.display = "flex";
  renderFolderBreadcrumb();
  loadFolderContents("root");
  const n = pendingUploadFiles.length;
  document.getElementById("folderConfirmBtn").textContent = `여기에 업로드 (${n}개)`;
}

function closeFolderPicker(e) {
  if (e && e.target !== document.getElementById("driveFolderModal")) return;
  document.getElementById("driveFolderModal").style.display = "none";
  pendingUploadFiles = [];
}

async function loadFolderContents(folderId) {
  const list = document.getElementById("folderList");
  list.innerHTML = `<div class="folder-picker-loading">불러오는 중...</div>`;

  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and trashed=false and '${folderId}' in parents`
  );
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=50`,
      { headers: { Authorization: `Bearer ${gmailToken}` } }
    );
    if (res.status === 401) { handleTokenExpired(); return; }
    const { files } = await res.json();

    if (!files?.length) {
      list.innerHTML = `<div class="folder-picker-empty">📂 하위 폴더가 없습니다</div>`;
      return;
    }
    list.innerHTML = files.map(f => `
      <div class="folder-picker-item" onclick="navigateToFolder('${f.id}', ${JSON.stringify(f.name)})">
        <span class="folder-picker-item-icon">📁</span>
        <span class="folder-picker-item-name">${f.name}</span>
        <span class="folder-picker-item-arrow">›</span>
      </div>`).join("");
  } catch {
    list.innerHTML = `<div class="folder-picker-empty">폴더를 불러올 수 없습니다</div>`;
  }
}

function navigateToFolder(id, name) {
  folderNavStack.push({ id, name });
  selectedFolderId = id;
  renderFolderBreadcrumb();
  loadFolderContents(id);
}

function navigateBreadcrumb(idx) {
  folderNavStack = folderNavStack.slice(0, idx + 1);
  const cur = folderNavStack[folderNavStack.length - 1];
  selectedFolderId = cur.id;
  renderFolderBreadcrumb();
  loadFolderContents(cur.id);
}

function renderFolderBreadcrumb() {
  const el = document.getElementById("folderBreadcrumb");
  el.innerHTML = folderNavStack.map((f, i) => {
    const isLast = i === folderNavStack.length - 1;
    return isLast
      ? `<span class="bc-current">${f.name}</span>`
      : `<span class="bc-link" onclick="navigateBreadcrumb(${i})">${f.name}</span><span class="bc-sep">›</span>`;
  }).join("");

  const hint = document.getElementById("folderPickerHint");
  const cur = folderNavStack[folderNavStack.length - 1];
  hint.textContent = `업로드 위치: ${cur.name}`;
}

async function confirmFolderUpload() {
  if (!pendingUploadFiles.length) return;
  document.getElementById("driveFolderModal").style.display = "none";
  const files = [...pendingUploadFiles];
  pendingUploadFiles = [];
  for (const f of files) {
    await uploadDriveFile(f, selectedFolderId);
  }
}

async function uploadDriveFile(file, folderId = "root") {
  const status = document.getElementById("driveStatus");
  status.textContent = `"${file.name}" 업로드 중...`;

  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  try {
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      { method: "POST", headers: { Authorization: `Bearer ${gmailToken}` }, body: form }
    );
    if (res.status === 401) { handleTokenExpired(); return; }
    if (!res.ok) {
      const err = await res.json();
      alert("업로드 실패: " + (err.error?.message || "알 수 없는 오류"));
      return;
    }
    const uploaded = await res.json();
    status.textContent = `"${uploaded.name}" 업로드 완료!`;
    fetchRecentFiles();
  } catch {
    alert("업로드 중 오류가 발생했습니다.");
  }
}

// ── Drive 미리보기 ──
function openDrivePreview(idx) {
  const f = currentDriveFiles[idx];
  if (!f) return;

  document.getElementById("drivePreviewName").textContent = f.name;
  document.getElementById("drivePreviewOpenLink").href = f.webViewLink;

  const content = document.getElementById("drivePreviewContent");

  if (f.mimeType.startsWith("image/")) {
    content.innerHTML = `<div class="drive-preview-img-wrap">
      <img src="https://drive.google.com/thumbnail?id=${f.id}&sz=w1200" alt="${f.name}">
    </div>`;
  } else {
    content.innerHTML = `<iframe src="https://drive.google.com/file/d/${f.id}/preview" allowfullscreen></iframe>`;
  }

  document.getElementById("drivePreviewModal").style.display = "flex";
}

function closeDrivePreview(e) {
  if (e && e.target !== document.getElementById("drivePreviewModal")) return;
  document.getElementById("drivePreviewContent").innerHTML = "";
  document.getElementById("drivePreviewModal").style.display = "none";
}

async function fetchRecentFiles() {
  const status = document.getElementById("driveStatus");
  document.getElementById("driveList").innerHTML = "";
  status.textContent = "최근 파일 불러오는 중...";

  try {
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/files" +
        "?orderBy=modifiedTime+desc&pageSize=15&q=trashed%3Dfalse" +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives" +
        "&fields=files(id,name,mimeType,modifiedTime,webViewLink)",
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );
    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    const { files } = await res.json();
    status.textContent = `최근 파일 ${files?.length || 0}개`;
    renderDriveFiles(files);
  } catch {
    status.textContent = "파일을 불러올 수 없습니다";
  }
}

async function searchDriveFiles() {
  const keyword = document.getElementById("driveSearchInput").value.trim();
  if (!keyword) return fetchRecentFiles();

  const status = document.getElementById("driveStatus");
  document.getElementById("driveList").innerHTML = "";
  status.textContent = "검색 중...";

  try {
    const q = encodeURIComponent(
      `name contains '${keyword}' and trashed = false`,
    );
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=20` +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives" +
        "&fields=files(id,name,mimeType,modifiedTime,webViewLink)",
      { headers: { Authorization: `Bearer ${gmailToken}` } },
    );
    if (res.status === 401) {
      handleTokenExpired();
      return;
    }
    const { files } = await res.json();
    status.textContent = `"${keyword}" 검색 결과 ${files?.length || 0}개`;
    renderDriveFiles(files);
  } catch {
    status.textContent = "검색 중 오류가 발생했습니다";
  }
}

function handleTokenExpired() {
  sessionStorage.removeItem("gmailToken");
  location.replace("login.html");
}

document.getElementById("calPrev").onclick = () => changeMonth(-1);
document.getElementById("calNext").onclick = () => changeMonth(1);

initTimeSelects();
renderCalendar();
selectDate(
  toDateStr(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
  ),
);

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
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
      { headers: { Authorization: `Bearer ${gmailToken}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const unread = data.messagesUnread ?? 0;
    document.getElementById("dashUnread").textContent = unread + "개";
  } catch { /* 무시 */ }
}

// 페이지 로드 시 자동 초기화
if (gmailToken) {
  fetchUserInfo();
  initDriveCard();
  fetchCalendarEvents(calYear, calMonth);
  fetchEmails();
  initDashboard();
  fetchDashboardUnread();
}

// ── Gemini 채팅 ──
//회사계정으로는 Gemini Api 무료토큰한도가 안나옴.(그래서 채팅막아놓음)
const GEMINI_API_KEY = ""; // 본인 Gemini API 키를 여기에 입력
const GEMINI_MODEL = "gemini-2.0-flash-lite";
let chatHistory = [];

function toggleChat() {
  const popup = document.getElementById("chatPopup");
  const isOpen = popup.style.display !== "none";
  popup.style.display = isOpen ? "none" : "flex";
  if (!isOpen) {
    if (chatHistory.length === 0) {
      appendChatMsg(
        "system",
        "안녕하세요.질문사항이나 해결하고싶은것을 물어보세요. ",
      );
    }
    setTimeout(() => document.getElementById("chatInput").focus(), 50);
  }
}

function appendChatMsg(role, text) {
  const box = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = `chat-msg chat-msg-${role}`;
  div.innerHTML = text.replace(/\n/g, "<br>");
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  appendChatMsg("user", text);
  chatHistory.push({ role: "user", parts: [{ text }] });

  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-msg chat-msg-model chat-thinking";
  thinkingEl.textContent = "답변 생성 중...";
  document.getElementById("chatMessages").appendChild(thinkingEl);
  document.getElementById("chatMessages").scrollTop = 999999;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: chatHistory }),
      },
    );
    const data = await res.json();

    thinkingEl.remove();

    if (!res.ok) {
      const errMsg = data.error?.message || "API 오류가 발생했습니다";
      appendChatMsg("error", `⚠️ ${errMsg}`);
      chatHistory.pop();
      return;
    }

    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "(응답 없음)";
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    appendChatMsg("model", reply);
  } catch {
    thinkingEl.remove();
    appendChatMsg("error", "⚠️ 네트워크 오류가 발생했습니다");
    chatHistory.pop();
  }
}
