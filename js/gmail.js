// ── Gmail 기능 ──
let currentMailbox = "inbox";
let currentSearchQuery = "";
// 페이징: 각 메일함마다 pageToken 스택 관리
const emailPageState = {
  inbox:  { tokens: [null], page: 0 },
  sent:   { tokens: [null], page: 0 },
  search: { tokens: [null], page: 0 },
};

function switchMailbox(type) {
  currentMailbox = type;
  currentSearchQuery = "";
  document.getElementById("gmailSearchInput").value = "";
  document.getElementById("gmailSearchClearBtn").style.display = "none";
  document.getElementById("tabInbox").classList.toggle("active", type === "inbox");
  document.getElementById("tabSent").classList.toggle("active", type === "sent");
  // 탭 전환 시 해당 메일함 첫 페이지부터
  emailPageState[type].tokens = [null];
  emailPageState[type].page = 0;
  fetchEmails();
}

async function searchEmails() {
  const q = document.getElementById("gmailSearchInput").value.trim();
  if (!q) return;
  currentSearchQuery = q;
  emailPageState.search.tokens = [null];
  emailPageState.search.page = 0;
  document.getElementById("gmailSearchClearBtn").style.display = "inline-block";
  await fetchSearchResults();
}

function clearEmailSearch() {
  currentSearchQuery = "";
  document.getElementById("gmailSearchInput").value = "";
  document.getElementById("gmailSearchClearBtn").style.display = "none";
  fetchEmails();
}

async function fetchEmails(pageToken = null) {
  const status = document.getElementById("gmailStatus");
  const list = document.getElementById("gmailList");
  const isSent = currentMailbox === "sent";
  status.textContent = "메일 불러오는 중...";
  list.innerHTML = "";

  try {
    const base = isSent ? "/api/gmail/sent" : "/api/gmail/inbox";
    const url = pageToken ? `${base}?pageToken=${encodeURIComponent(pageToken)}` : base;
    const listRes = await apiFetch(url);
    const data = await listRes.json();
    const { messages, nextPageToken } = data;

    if (!messages?.length) {
      status.textContent = "";
      list.innerHTML = `<p class="gmail-empty">${isSent ? "보낸 메일이 없습니다" : "받은 메일이 없습니다"}</p>`;
      renderEmailPagination(nextPageToken);
      return;
    }

    // nextPageToken을 스택에 저장 (아직 없는 경우만)
    const state = emailPageState[currentMailbox];
    if (nextPageToken && state.tokens.length <= state.page + 1) {
      state.tokens.push(nextPageToken);
    }

    const details = await Promise.all(
      messages.map((m) =>
        apiFetch(
          `/api/gmail/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`
        ).then((r) => r.json()),
      ),
    );

    status.textContent = `${state.page * 10 + 1}–${state.page * 10 + details.length}번째 메일`;
    if (!isSent) fetchDashboardUnread();
    list.innerHTML = renderEmailList(details, isSent);
    renderEmailPagination(nextPageToken);
  } catch (e) {
    status.textContent = "메일을 불러올 수 없습니다";
  }
}

function renderEmailList(details, isSent) {
  return details.map((msg) => {
    const h = (name) => msg.payload.headers.find((x) => x.name === name)?.value || "";
    const subject = h("Subject") || "(제목 없음)";
    const senderOrRecipient = isSent
      ? (h("To").replace(/<[^>]+>/, "").replace(/"/g, "").trim() || h("To"))
      : (h("From").replace(/<[^>]+>/, "").replace(/"/g, "").trim() || h("From"));
    const dateStr = (() => {
      const d = new Date(h("Date"));
      return isNaN(d) ? h("Date") : d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    })();
    const snippet = msg.snippet || "";
    const isUnread = msg.labelIds?.includes("UNREAD");
    return `
    <div class="gmail-item${isUnread ? " gmail-unread" : ""}" onclick="showEmailDetail('${msg.id}')">
      <div class="gmail-from">${isUnread ? '<span class="gmail-unread-dot"></span>' : ""}${isSent ? "받는 사람: " : ""}${senderOrRecipient}</div>
      <div class="gmail-subject">${subject}</div>
      <div class="gmail-snippet">${snippet}</div>
      <div class="gmail-date">${dateStr}</div>
    </div>`;
  }).join("");
}

function renderEmailPagination(nextPageToken, isSearch = false) {
  const stateKey = isSearch ? "search" : currentMailbox;
  const state = emailPageState[stateKey];
  const existing = document.getElementById("gmailPagination");
  if (existing) existing.remove();

  if (state.page === 0 && !nextPageToken) return;

  const prevFn = isSearch ? "searchPrevPage()" : "emailPrevPage()";
  const nextFn = isSearch ? "searchNextPage()" : "emailNextPage()";
  const div = document.createElement("div");
  div.id = "gmailPagination";
  div.className = "gmail-pagination";
  div.innerHTML = `
    <button onclick="${prevFn}" ${state.page === 0 ? "disabled" : ""}>&#8249; 이전</button>
    <span>${state.page + 1}페이지</span>
    <button onclick="${nextFn}" ${!nextPageToken ? "disabled" : ""}>다음 &#8250;</button>
  `;
  document.getElementById("gmailList").after(div);
}

function emailPrevPage() {
  const state = emailPageState[currentMailbox];
  if (state.page <= 0) return;
  state.page--;
  fetchEmails(state.tokens[state.page]);
}

function emailNextPage() {
  const state = emailPageState[currentMailbox];
  const nextToken = state.tokens[state.page + 1];
  if (!nextToken) return;
  state.page++;
  fetchEmails(nextToken);
}

async function fetchSearchResults(pageToken = null) {
  const status = document.getElementById("gmailStatus");
  const list = document.getElementById("gmailList");
  status.textContent = `"${currentSearchQuery}" 검색 중...`;
  list.innerHTML = "";

  try {
    const qs = new URLSearchParams({ q: currentSearchQuery });
    if (pageToken) qs.set("pageToken", pageToken);
    const listRes = await apiFetch(`/api/gmail/search?${qs}`);
    const { messages, nextPageToken } = await listRes.json();

    const state = emailPageState.search;
    if (nextPageToken && state.tokens.length <= state.page + 1) {
      state.tokens.push(nextPageToken);
    }

    if (!messages?.length) {
      status.textContent = `"${currentSearchQuery}" 검색 결과 없음`;
      list.innerHTML = `<p class="gmail-empty">검색 결과가 없습니다.</p>`;
      renderEmailPagination(null, true);
      return;
    }

    const details = await Promise.all(
      messages.map((m) =>
        apiFetch(`/api/gmail/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`)
          .then((r) => r.json())
      )
    );

    status.textContent = `"${currentSearchQuery}" — ${state.page * 10 + 1}–${state.page * 10 + details.length}번째 결과`;
    list.innerHTML = renderEmailList(details, false);
    renderEmailPagination(nextPageToken, true);
  } catch {
    status.textContent = "검색 중 오류가 발생했습니다.";
  }
}

function searchPrevPage() {
  const state = emailPageState.search;
  if (state.page <= 0) return;
  state.page--;
  fetchSearchResults(state.tokens[state.page]);
}

function searchNextPage() {
  const state = emailPageState.search;
  const nextToken = state.tokens[state.page + 1];
  if (!nextToken) return;
  state.page++;
  fetchSearchResults(nextToken);
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
    const res = await apiFetch(`/api/gmail/attachments/${msgId}/${attachmentId}`);
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
    Swal.fire({ icon: "error", title: "오류", text: "첨부파일 다운로드 중 오류가 발생했습니다." });
  }
}

function getBodyFromPart(part) {
  if (!part) return null;
  if (part.mimeType === "text/html" && part.body?.data)
    return { type: "html", data: part.body.data };
  if (part.mimeType === "text/plain" && part.body?.data)
    return { type: "text", data: part.body.data };
  if (part.parts) {
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
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
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
  document.getElementById("emailModalTo").textContent = "";
  document.getElementById("emailModalCc").textContent = "";
  document.getElementById("emailModalCc").style.display = "none";
  document.getElementById("emailModalDate").textContent = "";
  document.getElementById("emailModalBody").innerHTML =
    `<div class="email-modal-loading">메일 불러오는 중...</div>`;
  modal.style.display = "flex";

  try {
    const res = await apiFetch(`/api/gmail/messages/${msgId}?format=full`);
    const msg = await res.json();
    const h = (name) =>
      msg.payload.headers.find((x) => x.name === name)?.value || "";

    // "홍길동 <email@example.com>" → "홍길동 (email@example.com)"
    // "<email@example.com>" → "email@example.com"
    function fmtAddr(raw) {
      const match = raw.match(/^"?([^"<]+?)"?\s*<(.+?)>$/);
      if (match) {
        const name = match[1].trim();
        const email = match[2].trim();
        return name ? `${name} (${email})` : email;
      }
      return raw.replace(/[<>]/g, "").trim();
    }
    function fmtAddrList(raw) {
      return raw.split(/,(?![^<]*>)/).map(a => fmtAddr(a.trim())).filter(Boolean).join(", ");
    }

    const subject = h("Subject") || "(제목 없음)";
    const from = fmtAddr(h("From")) || h("From");
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

    const toRaw = h("To");
    const ccRaw = h("Cc");
    const toDisplay = fmtAddrList(toRaw);
    const ccDisplay = fmtAddrList(ccRaw);

    document.getElementById("emailModalSubject").textContent = subject;
    document.getElementById("emailModalFrom").textContent = "보낸 사람: " + from;
    document.getElementById("emailModalTo").textContent = toDisplay ? "받는 사람: " + toDisplay : "";
    const ccEl = document.getElementById("emailModalCc");
    if (ccDisplay) {
      ccEl.textContent = "참조: " + ccDisplay;
      ccEl.style.display = "inline";
    } else {
      ccEl.style.display = "none";
    }
    document.getElementById("emailModalDate").textContent = dateStr;

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
      bodyText: "",
    };

    const bodyEl = document.getElementById("emailModalBody");

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
        const iframe = document.createElement("iframe");
        iframe.sandbox = "allow-same-origin";
        iframe.style.cssText =
          "width:100%;border:none;min-height:300px;background:#fff;border-radius:8px;";
        iframe.srcdoc = decoded;
        bodyEl.innerHTML = "";
        bodyEl.appendChild(iframe);
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
  if (!name) { Swal.fire({ icon: "warning", title: "서명 이름을 입력하세요.", timer: 1500, showConfirmButton: false }); return; }
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
async function deleteSignature(id) {
  const result = await Swal.fire({
    title: "이 서명을 삭제할까요?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e53935",
    cancelButtonColor: "#aaa",
    confirmButtonText: "삭제",
    cancelButtonText: "취소",
  });
  if (!result.isConfirmed) return;
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
    // 서명 앞에 타이핑 가능한 공간이 없으면 빈 단락 추가
    const hasTypingArea = [...body.childNodes].some(
      (n) => !(n.classList && n.classList.contains("compose-sig-block"))
    );
    if (!hasTypingArea) {
      body.innerHTML = "<p><br></p>";
    }

    const block = document.createElement("div");
    block.className = "compose-sig-block";
    block.setAttribute("contenteditable", "false");
    block.innerHTML = sig.content;
    body.appendChild(block);

    // 커서를 서명 위 타이핑 영역으로 이동
    body.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    const target = body.firstChild;
    if (target && target !== block) {
      range.setStart(target, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
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
let currentEmailMeta = null;
let composeFiles = [];
let currentComposeSignature = null;

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

  const temp = document.createElement("div");
  temp.innerHTML = bodyHtml || "";
  temp.querySelectorAll(".compose-sig-block").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("class");
    el.style.cssText = "margin-top:16px;font-size:13px;";
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

  if (!to) { Swal.fire({ icon: "warning", title: "받는 사람 이메일을 입력하세요.", timer: 1500, showConfirmButton: false }); return; }
  if (!subject) { Swal.fire({ icon: "warning", title: "제목을 입력하세요.", timer: 1500, showConfirmButton: false }); return; }

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

    const res = await apiFetch("/api/gmail/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      Swal.fire({ icon: "error", title: "전송 실패", text: err.error?.message || "알 수 없는 오류" });
      return;
    }

    closeCompose();
    closeEmailModal();
    Swal.fire({ icon: "success", title: "전송 완료!", timer: 1500, showConfirmButton: false });
  } catch {
    Swal.fire({ icon: "error", title: "오류", text: "전송 중 오류가 발생했습니다." });
  } finally {
    sendBtn.textContent = "전송";
    sendBtn.disabled = false;
  }
}

// ── 예약 발송 ──
function toggleSchedulePicker() {
  const picker = document.getElementById("schedulePicker");
  const isOpen = picker.style.display !== "none";
  picker.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    // 기본값: 1시간 후
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    document.getElementById("scheduleDateTime").value = local;
  }
}

async function sendScheduledEmail() {
  const to = document.getElementById("composeTo").value.trim();
  const cc = document.getElementById("composeCc").value.trim();
  const subject = document.getElementById("composeSubject").value.trim();
  const bodyHtml = document.getElementById("composeBody").innerHTML;
  const scheduledAt = document.getElementById("scheduleDateTime").value;

  if (!to) { Swal.fire({ icon: "warning", title: "받는 사람 이메일을 입력하세요.", timer: 1500, showConfirmButton: false }); return; }
  if (!subject) { Swal.fire({ icon: "warning", title: "제목을 입력하세요.", timer: 1500, showConfirmButton: false }); return; }
  if (!scheduledAt) { Swal.fire({ icon: "warning", title: "예약 시간을 선택하세요.", timer: 1500, showConfirmButton: false }); return; }
  if (new Date(scheduledAt) <= new Date()) { Swal.fire({ icon: "warning", title: "예약 시간은 현재 이후여야 합니다." }); return; }

  try {
    const raw = await buildMimeRaw({
      to, cc, subject, bodyHtml,
      files: composeFiles,
      threadId: currentEmailMeta?.threadId,
      messageId: currentEmailMeta?.messageId,
    });

    const res = await apiFetch("/api/gmail/scheduled", {
      method: "POST",
      body: JSON.stringify({
        to, cc, subject, raw,
        threadId: currentEmailMeta?.threadId || null,
        scheduledAt,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      Swal.fire({ icon: "error", title: "예약 실패", text: err.error || "알 수 없는 오류" });
      return;
    }

    const dt = new Date(scheduledAt).toLocaleString("ko-KR", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    Swal.fire({ icon: "success", title: "예약 완료!", text: `${dt} 에 발송됩니다.`, timer: 2500, showConfirmButton: false });
    closeCompose();
    closeEmailModal();
  } catch {
    Swal.fire({ icon: "error", title: "오류", text: "예약 중 오류가 발생했습니다." });
  }
}

let currentScheduledTab = "pending";

async function showScheduledList() {
  document.getElementById("scheduledListModal").style.display = "flex";
  await loadScheduledTab(currentScheduledTab);
}

async function switchScheduledTab(status) {
  currentScheduledTab = status;
  ["pending", "sent", "failed"].forEach(s => {
    document.getElementById(`stab-${s}`).classList.toggle("active", s === status);
  });
  await loadScheduledTab(status);
}

async function loadScheduledTab(status) {
  const body = document.getElementById("scheduledListBody");
  body.innerHTML = '<div class="scheduled-empty">불러오는 중...</div>';

  try {
    const res = await apiFetch(`/api/gmail/scheduled?status=${status}`);
    const list = await res.json();

    if (!list.length) {
      const labels = { pending: "대기 중인 예약이 없습니다.", sent: "발송 완료된 메일이 없습니다.", failed: "실패한 메일이 없습니다." };
      body.innerHTML = `<div class="scheduled-empty">${labels[status]}</div>`;
      return;
    }

    body.innerHTML = list.map(item => {
      const scheduledDt = new Date(item.scheduled_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const sentDt = item.sent_at ? new Date(item.sent_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

      const statusBadge = {
        pending: `<span class="sched-badge pending">대기중</span>`,
        sent:    `<span class="sched-badge sent">발송완료</span>`,
        failed:  `<span class="sched-badge failed">실패</span>`,
      }[item.status];

      const metaLine = item.status === "sent"
        ? `To: ${item.to_addr} · 예약: ${scheduledDt} · 발송: ${sentDt}`
        : item.status === "failed"
          ? `To: ${item.to_addr} · 예약: ${scheduledDt} · 사유: ${item.error_msg || "알 수 없음"}`
          : `To: ${item.to_addr} · ${scheduledDt} 발송 예정`;

      const actionBtn = item.status === "pending"
        ? `<button class="scheduled-cancel-btn" onclick="cancelScheduled(${item.id})">취소</button>`
        : "";

      return `
      <div class="scheduled-item">
        <div class="scheduled-item-info">
          <div class="scheduled-item-subject">${statusBadge} ${item.subject || "(제목 없음)"}</div>
          <div class="scheduled-item-meta">${metaLine}</div>
        </div>
        ${actionBtn}
      </div>`;
    }).join("");
  } catch {
    body.innerHTML = '<div class="scheduled-empty">불러오기 실패</div>';
  }
}

function closeScheduledList(e) {
  if (e && e.target !== document.getElementById("scheduledListModal")) return;
  document.getElementById("scheduledListModal").style.display = "none";
}

async function cancelScheduled(id) {
  const result = await Swal.fire({
    title: "예약을 취소할까요?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e53935",
    cancelButtonColor: "#aaa",
    confirmButtonText: "취소하기",
    cancelButtonText: "닫기",
  });
  if (!result.isConfirmed) return;

  const res = await apiFetch(`/api/gmail/scheduled/${id}`, { method: "DELETE" });
  if (res.ok) {
    Swal.fire({ icon: "success", title: "예약이 취소되었습니다.", timer: 1500, showConfirmButton: false });
    await loadScheduledTab("pending");
  }
}

// X 버튼: 컴포즈가 열려있으면 임시저장 확인, 아니면 바로 닫기
function onEmailModalCloseBtn() {
  const composeVisible = document.getElementById("emailComposeArea").style.display !== "none";
  if (composeVisible) {
    tryCloseCompose();
  } else {
    closeEmailModal();
  }
}

// ── AI 이메일 요약 ──
async function summarizeEmail() {
  if (!currentEmailMeta) return;

  const btn = document.querySelector(".email-ai-btn");
  const summaryEl = document.getElementById("emailAiSummary");

  btn.disabled = true;
  btn.textContent = "요약 중...";
  summaryEl.style.display = "block";
  summaryEl.innerHTML = `<div class="email-ai-loading">✨ AI가 요약하는 중...</div>`;

  try {
    const res = await apiFetch("/api/ai/summarize-email", {
      method: "POST",
      body: JSON.stringify({
        subject: currentEmailMeta.subject,
        from: currentEmailMeta.from,
        body: currentEmailMeta.bodyText.slice(0, 4000),
      }),
    });
    const { summary, error } = await res.json();
    if (error) throw new Error(error);

    summaryEl.innerHTML = `
      <div class="email-ai-header">✨ AI 요약</div>
      <div class="email-ai-content">${summary.replace(/\n/g, "<br>")}</div>`;
  } catch (e) {
    summaryEl.innerHTML = `<div class="email-ai-error">요약 실패: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ AI 요약";
  }
}

function closeEmailModal(e) {
  if (e && e.target !== document.getElementById("emailModal")) return;
  // 새 메일 작성 중에는 오버레이 클릭으로 닫히지 않음
  if (e && currentEmailMeta === null) return;
  document.getElementById("emailModal").style.display = "none";
  document.getElementById("emailModalBody").innerHTML = "";
  document.getElementById("emailModalAttachments").innerHTML = "";
  document.getElementById("emailModalAttachments").style.display = "none";
  document.getElementById("emailAiSummary").style.display = "none";
  document.getElementById("emailAiSummary").innerHTML = "";
  document.querySelector(".email-modal-actions").style.display = "";
  closeCompose();
  currentEmailMeta = null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEmailModal();
});
