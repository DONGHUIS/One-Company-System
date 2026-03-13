// ── 일정 기능 (Google Calendar / 로컬 DB) ──
function calBase() {
  return gmailToken ? "/api/calendar" : "/api/local";
}

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
    ? start <= dateStr && dateStr < end
    : start <= dateStr && dateStr <= end;
}

function renderCalendar() {
  const datesWithEvent = new Set(
    gcalEvents.flatMap((e) => {
      const start = (e.start.dateTime || e.start.date).substring(0, 10);
      const rawEnd = (e.end.dateTime || e.end.date).substring(0, 10);
      const end = e.end.date
        ? new Date(new Date(rawEnd) - 86400000).toISOString().substring(0, 10)
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
  document.getElementById("btnAddSchedule").style.display = "inline-block";
}

function renderScheduleList() {
  const list = document.getElementById("scheduleList");

  if (selectedDate) {
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

  const startDate = (e.start.dateTime || e.start.date).substring(0, 10);
  document.getElementById("scheduleStartDate").value = startDate;

  let endDate;
  if (e.end.date) {
    const d = new Date(e.end.date);
    d.setDate(d.getDate() - 1);
    endDate = d.toISOString().substring(0, 10);
  } else {
    endDate = e.end.dateTime.substring(0, 10);
  }
  document.getElementById("scheduleEndDate").value = endDate;

  if (e.start.dateTime) {
    const [sh, sm] = e.start.dateTime.substring(11, 16).split(":");
    document.getElementById("scheduleStartHour").value = parseInt(sh);
    document.getElementById("scheduleStartMin").value = sm;
  } else {
    document.getElementById("scheduleStartHour").value = "";
    document.getElementById("scheduleStartMin").value = "00";
  }

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

  if (!title) { Swal.fire({ icon: "warning", title: "일정 제목을 입력하세요!", timer: 1500, showConfirmButton: false }); return; }
  if (!startDateVal) { Swal.fire({ icon: "warning", title: "시작일을 선택하세요!", timer: 1500, showConfirmButton: false }); return; }
  if (endDateVal && endDateVal < startDateVal) { Swal.fire({ icon: "warning", title: "날짜 오류", text: "종료일이 시작일보다 이전일 수 없습니다." }); return; }

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
    const res = await apiFetch(
      editingEventId ? `${calBase()}/events/${editingEventId}` : `${calBase()}/events`,
      { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(eventBody) }
    );
    if (!res.ok) {
      const err = await res.json();
      Swal.fire({ icon: "error", title: (editingEventId ? "수정" : "저장") + " 실패", text: err.error?.message || "알 수 없는 오류" });
      return;
    }
    resetScheduleForm();
    document.getElementById("addScheduleForm").style.display = "none";
    await fetchCalendarEvents(calYear, calMonth);
  } catch {
    Swal.fire({ icon: "error", title: "네트워크 오류", text: "잠시 후 다시 시도해주세요." });
  }
}

function showScheduleDetail(eventId) {
  const e = gcalEvents.find((ev) => ev.id === eventId);
  if (!e) return;

  document.getElementById("sdmTitle").textContent = e.summary || "(제목 없음)";

  const fmtTime = (dt) =>
    new Date(dt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const fmtDate = (raw) => {
    const d = new Date(raw);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  const startDateStr = fmtDate(e.start.dateTime || e.start.date);
  const endRaw =
    e.end.dateTime ||
    (() => {
      const d = new Date(e.end.date);
      d.setDate(d.getDate() - 1);
      return d.toISOString().substring(0, 10);
    })();
  const endDateStr = fmtDate(endRaw);
  const isMultiDay = startDateStr !== endDateStr;

  let dateStr;
  if (e.start.dateTime) {
    const startPart = `${startDateStr} ${fmtTime(e.start.dateTime)}`;
    const endPart = e.end.dateTime
      ? `${isMultiDay ? endDateStr + " " : ""}${fmtTime(e.end.dateTime)}`
      : "";
    dateStr = endPart ? `${startPart} ~ ${endPart}` : startPart;
  } else {
    dateStr = isMultiDay ? `${startDateStr} ~ ${endDateStr}` : `${startDateStr} (종일)`;
  }

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
      <span>${dateStr}</span>
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
  const result = await Swal.fire({
    title: "이 일정을 삭제할까요?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e53935",
    cancelButtonColor: "#aaa",
    confirmButtonText: "삭제",
    cancelButtonText: "취소",
  });
  if (!result.isConfirmed) return;
  try {
    const res = await apiFetch(`${calBase()}/events/${eventId}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      document.getElementById("scheduleDetailModal").style.display = "none";
      await fetchCalendarEvents(calYear, calMonth);
    }
  } catch {
    Swal.fire({ icon: "error", title: "오류", text: "삭제 중 오류가 발생했습니다." });
  }
}

async function fetchCalendarEvents(year, month) {
  const timeMin = encodeURIComponent(new Date(year, month, 1).toISOString());
  const timeMax = encodeURIComponent(
    new Date(year, month + 1, 0, 23, 59, 59).toISOString(),
  );
  try {
    const res = await apiFetch(
      `${calBase()}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`
    );
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

// 캘린더 초기화
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
