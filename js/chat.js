// ── Gemini 채팅 ──
// 회사계정으로는 Gemini Api 무료토큰한도가 안나옴.(그래서 채팅막아놓음)
const GEMINI_API_KEY = ""; // 본인 Gemini API 키를 여기에 입력
const GEMINI_MODEL = "gemini-2.0-flash-lite";
const CHAT_STORAGE_KEY = "gemini_chat_sessions";

let chatHistory = [];       // 현재 세션 API용 배열
let chatMessages = [];      // 현재 세션 렌더용 배열 [{role, text}]
let currentSessionId = null;

// ── 세션 저장/불러오기 ──
function loadChatSessions() {
  try { return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveChatSessions(sessions) {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(sessions));
}

function saveCurrentSession() {
  // 유저 메시지가 1개 이상일 때만 저장
  const userMsgs = chatMessages.filter(m => m.role === "user");
  if (userMsgs.length === 0) return;

  const sessions = loadChatSessions();
  const title = userMsgs[0].text.slice(0, 30) + (userMsgs[0].text.length > 30 ? "…" : "");
  const session = {
    id: currentSessionId,
    title,
    time: Date.now(),
    messages: chatMessages,
  };

  const idx = sessions.findIndex(s => s.id === currentSessionId);
  if (idx >= 0) sessions[idx] = session;
  else sessions.unshift(session);

  // 최대 30개 보관
  saveChatSessions(sessions.slice(0, 30));
}

function startNewSession() {
  currentSessionId = Date.now().toString();
  chatHistory = [];
  chatMessages = [];
  document.getElementById("chatMessages").innerHTML = "";
  appendChatMsg("system", "안녕하세요. 질문사항이나 해결하고싶은것을 물어보세요.");
}

// ── 팝업 토글 ──
function toggleChat() {
  if (!gmailToken) {
    Swal.fire({ icon: "info", title: "AI 채팅 이용 불가", text: "일반 로그인 시 AI 채팅 기능은 이용하실 수 없습니다.", confirmButtonColor: "#4f8ef7" });
    return;
  }
  const popup = document.getElementById("chatPopup");
  const isOpen = popup.style.display !== "none";

  if (isOpen) {
    // 닫을 때 현재 세션 저장
    saveCurrentSession();
    popup.style.display = "none";
    document.getElementById("chatHistoryPanel").style.display = "none";
  } else {
    // 열 때 새 세션 시작
    startNewSession();
    popup.style.display = "flex";
    setTimeout(() => document.getElementById("chatInput").focus(), 50);
  }
}

// ── 이전 대화 패널 ──
function toggleChatHistory() {
  const panel = document.getElementById("chatHistoryPanel");
  const isOpen = panel.style.display !== "none";
  if (isOpen) {
    panel.style.display = "none";
  } else {
    renderChatHistoryList();
    panel.style.display = "flex";
  }
}

function renderChatHistoryList() {
  const sessions = loadChatSessions();
  const list = document.getElementById("chatHistoryList");
  list.innerHTML = "";

  if (sessions.length === 0) {
    list.innerHTML = '<div class="chat-history-empty">저장된 대화가 없습니다.</div>';
    return;
  }

  sessions.forEach(s => {
    const item = document.createElement("div");
    item.className = "chat-history-item";
    const date = new Date(s.time).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    item.innerHTML = `
      <div class="chat-history-item-title">${s.title}</div>
      <div class="chat-history-item-date">${date}</div>
    `;
    item.onclick = () => viewChatSession(s.id);
    list.appendChild(item);
  });
}

function viewChatSession(sessionId) {
  const sessions = loadChatSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  document.getElementById("chatHistoryPanel").style.display = "none";

  const box = document.getElementById("chatMessages");
  box.innerHTML = `<div class="chat-session-label">📋 ${session.title} <button onclick="backToCurrentChat()" style="margin-left:8px;font-size:11px;padding:2px 7px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer">← 현재 대화로</button></div>`;

  session.messages.forEach(m => {
    const div = document.createElement("div");
    div.className = `chat-msg chat-msg-${m.role}`;
    div.innerHTML = m.text.replace(/\n/g, "<br>");
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function backToCurrentChat() {
  const box = document.getElementById("chatMessages");
  box.innerHTML = "";
  chatMessages.forEach(m => {
    const div = document.createElement("div");
    div.className = `chat-msg chat-msg-${m.role}`;
    div.innerHTML = m.text.replace(/\n/g, "<br>");
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

// ── 메시지 렌더 ──
function appendChatMsg(role, text) {
  const box = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = `chat-msg chat-msg-${role}`;
  div.innerHTML = text.replace(/\n/g, "<br>");
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  if (role !== "system") chatMessages.push({ role, text });
}

// ── 메시지 전송 ──
async function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  appendChatMsg("user", text);
  chatHistory.push({ role: "user", parts: [{ text }] });

  // API 키 없으면 서비스 준비중 안내
  if (!GEMINI_API_KEY) {
    appendChatMsg("system", "🚧 죄송합니다. 현재 AI 채팅 서비스는 오픈 준비중입니다.");
    chatHistory.pop();
    return;
  }

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
      appendChatMsg("system", "🚧 AI 채팅 서비스 오픈 준비중입니다.");
      chatHistory.pop();
      return;
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "(응답 없음)";
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    appendChatMsg("model", reply);
  } catch {
    thinkingEl.remove();
    appendChatMsg("system", "🚧 AI 채팅 서비스 오픈 준비중입니다.");
    chatHistory.pop();
  }
}
