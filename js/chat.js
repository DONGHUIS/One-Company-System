// ── Gemini 채팅 ──
// 회사계정으로는 Gemini Api 무료토큰한도가 안나옴.(그래서 채팅막아놓음)
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

  // API 키 없으면 서비스 준비중 안내
  if (!GEMINI_API_KEY) {
    appendChatMsg(
      "system",
      "🚧 죄송합니다. 현재 AI 채팅 서비스는 오픈 준비중입니다.",
    );
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

    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "(응답 없음)";
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    appendChatMsg("model", reply);
  } catch {
    thinkingEl.remove();
    appendChatMsg("system", "🚧 AI 채팅 서비스 오픈 준비중입니다.");
    chatHistory.pop();
  }
}
