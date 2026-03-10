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
    const res = await apiFetch(
      `/api/drive/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=50`
    );
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

  try {
    const b64 = await fileToBase64(file);
    const res = await apiFetch("/api/drive/upload", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        b64,
        folderId,
      }),
    });
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
    const res = await apiFetch(
      "/api/drive/files?orderBy=modifiedTime+desc&pageSize=15&q=trashed%3Dfalse" +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives" +
        "&fields=files(id,name,mimeType,modifiedTime,webViewLink)"
    );
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
    const res = await apiFetch(
      `/api/drive/files?q=${q}&pageSize=20` +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives" +
        "&fields=files(id,name,mimeType,modifiedTime,webViewLink)"
    );
    const { files } = await res.json();
    status.textContent = `"${keyword}" 검색 결과 ${files?.length || 0}개`;
    renderDriveFiles(files);
  } catch {
    status.textContent = "검색 중 오류가 발생했습니다";
  }
}
