// ── 메모 기능 ──
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

// ── 날씨 기능 ──
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
