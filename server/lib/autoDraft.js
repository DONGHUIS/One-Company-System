// ── Jira 로그인 문의 자동 초안 생성 ──
//
// 흐름:
//   1. Gmail 에서 "[Jira] + 로그인 문의" 메일 검색 (config.gmailQuery)
//   2. 메일의 첨부/인라인 이미지를 내려받아 Claude 비전으로
//      - 로그인 문의가 맞는지 확인
//      - 이미지(없으면 본문)에서 문의한 사용자의 이메일 주소 추출
//   3. 추출한 이메일을 수신자로 지정 답변(config.draftBody) 초안을
//      Gmail 임시보관함(drafts)에 생성 — 발송은 하지 않는다.
//   4. auto_draft_logs 에 메시지 ID 를 기록해 같은 메일을 두 번 처리하지 않는다.
//
// 자동 발송이 아니라 초안 생성이므로, 오분류하더라도 사람이 임시보관함에서
// 확인 후 보내는 안전장치가 있다.

const Anthropic = require("@anthropic-ai/sdk");
const db = require("../db");
const batchLog = require("./batchLog");
const { getFreshAccessToken } = require("./googleTokens");
const config = require("../config/autoDraft");

const JOB = "Jira초안";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
// Claude 비전이 받는 이미지 형식만 넘긴다
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGES = 4; // Jira 알림에는 아바타 등 잡다한 이미지가 섞이므로 큰 것 위주 상위 4장만

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS auto_draft_logs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      gmail_msg_id VARCHAR(32) NOT NULL UNIQUE,
      user_id      INT NOT NULL,
      status       ENUM('processing','drafted','skipped','failed') NOT NULL DEFAULT 'processing',
      to_addr      VARCHAR(255),
      detail       VARCHAR(500),
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  tableReady = true;
}

// ── 초안을 만들 메일함 소유자 결정 ──
async function resolveOwner() {
  if (config.ownerEmail) {
    const [rows] = await db.query(
      `SELECT id, email FROM users WHERE email=? AND google_refresh_token IS NOT NULL`,
      [config.ownerEmail]
    );
    if (!rows.length)
      throw new Error(`${config.ownerEmail} 사용자의 Google 리프레시 토큰이 없습니다 (재로그인 필요)`);
    return rows[0];
  }
  const [rows] = await db.query(
    `SELECT id, email FROM users WHERE google_refresh_token IS NOT NULL`
  );
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new Error("Google 연동된 사용자가 없습니다");
  throw new Error("Google 연동 사용자가 여럿입니다 — AUTODRAFT_OWNER_EMAIL 환경변수로 지정하세요");
}

// ── Gmail 유틸 ──
async function gmailGet(token, path) {
  const res = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail ${path}: ${data.error?.message || res.status}`);
  return data;
}

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const toB64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 메일 payload 트리를 돌며 텍스트 본문과 이미지 파트를 모은다
function walkParts(part, out) {
  if (!part) return;
  const mime = part.mimeType || "";
  if (mime === "text/plain" && part.body?.data) {
    out.text += fromB64url(part.body.data).toString("utf8") + "\n";
  } else if (mime === "text/html" && part.body?.data) {
    out.html += fromB64url(part.body.data).toString("utf8");
  } else if (IMAGE_TYPES.has(mime)) {
    out.images.push({
      mimeType: mime,
      size: part.body?.size || 0,
      attachmentId: part.body?.attachmentId || null,
      data: part.body?.data || null, // 작은 인라인 이미지는 본문에 바로 들어있다
    });
  }
  for (const p of part.parts || []) walkParts(p, out);
}

const stripHtml = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// ── Claude 비전: 로그인 문의 여부 + 사용자 이메일 추출 ──
async function analyzeMail({ subject, bodyText, images }) {
  const content = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType, data: img.base64 },
  }));
  content.push({
    type: "text",
    text:
      `다음은 Jira 알림 메일이다. 첨부된 이미지가 있으면 그 안의 내용까지 읽고 판단하라.\n\n` +
      `제목: ${subject}\n\n본문:\n${bodyText.slice(0, 4000)}\n\n` +
      `판단할 것:\n` +
      `1. 이 메일이 "로그인 문의"(로그인 오류, 로그인 불가 등 로그인 관련 고객 문의)에 해당하는가?\n` +
      `2. 문의를 남긴 사용자(고객)의 이메일 주소. 이미지 안에 있는 이메일을 최우선으로 찾고, ` +
      `없으면 본문 텍스트에서 찾아라. Jira/Atlassian 시스템 주소나 사내 담당자 주소는 제외한다.\n\n` +
      `반드시 아래 JSON 형식으로만 답하라 (설명 금지):\n` +
      `{"isLoginInquiry": true/false, "userEmail": "이메일 또는 null", "reason": "한 줄 근거"}`,
  });

  const msg = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 500,
    messages: [{ role: "user", content }],
  });

  const text = msg.content.find((b) => b.type === "text")?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI 응답 파싱 실패: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ── 초안 MIME 생성 ──
const encodeHeader = (s) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

function buildDraftRaw(to, subject, body) {
  const b64body = Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64body,
  ].join("\r\n");
  return toB64url(Buffer.from(mime, "utf8"));
}

// ── 메일 1건 처리 ──
async function processMessage(token, userId, msgId) {
  // 처리권 선점 (UNIQUE 키) — 틱이 겹쳐도 같은 메일을 두 번 처리하지 않는다
  const [claim] = await db.query(
    `INSERT IGNORE INTO auto_draft_logs (gmail_msg_id, user_id) VALUES (?,?)`,
    [msgId, userId]
  );
  if (!claim.affectedRows) return null;

  const setStatus = (status, toAddr, detail) =>
    db.query(
      `UPDATE auto_draft_logs SET status=?, to_addr=?, detail=? WHERE gmail_msg_id=?`,
      [status, toAddr, String(detail || "").slice(0, 500), msgId]
    );

  try {
    const full = await gmailGet(token, `/messages/${msgId}?format=full`);
    const headers = Object.fromEntries(
      (full.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
    );
    const subject = headers.subject || "";

    const out = { text: "", html: "", images: [] };
    walkParts(full.payload, out);
    const bodyText = out.text || stripHtml(out.html);

    // Gmail 검색 결과 2차 확인 — 키워드가 실제 제목/본문에 있는지.
    // Jira 알림은 이슈 제목("[스마트택배 문의]...로그인 문의")이 HTML 쪽에만
    // 있는 경우가 있어 text/plain 과 HTML 을 모두 본다.
    const searchable = subject + "\n" + out.text + "\n" + stripHtml(out.html);
    if (!searchable.includes(config.mustInclude)) {
      await setStatus("skipped", null, `키워드 '${config.mustInclude}' 없음`);
      return { status: "skipped" };
    }

    // 이미지 내려받기 — 큰 이미지(스크린샷) 우선, 아이콘류(10KB 미만) 제외
    const picked = out.images
      .filter((i) => i.size >= 10 * 1024 || i.data)
      .sort((a, b) => b.size - a.size)
      .slice(0, MAX_IMAGES);
    const images = [];
    for (const img of picked) {
      let data = img.data;
      if (!data && img.attachmentId) {
        const att = await gmailGet(token, `/messages/${msgId}/attachments/${img.attachmentId}`);
        data = att.data;
      }
      if (!data) continue;
      const buf = fromB64url(data);
      if (buf.length > 4.5 * 1024 * 1024) continue; // Claude 이미지 크기 제한(5MB) 여유
      images.push({ mimeType: img.mimeType, base64: buf.toString("base64") });
    }

    const result = await analyzeMail({ subject, bodyText, images });
    batchLog.log(
      JOB,
      `분석 msg=${msgId} 로그인문의=${!!result.isLoginInquiry} email=${result.userEmail || "-"} (이미지 ${images.length}장)`
    );

    if (!result.isLoginInquiry) {
      await setStatus("skipped", null, `로그인 문의 아님: ${result.reason || ""}`);
      return { status: "skipped" };
    }
    const email = String(result.userEmail || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await setStatus("skipped", null, `사용자 이메일 추출 실패 (이미지 ${images.length}장)`);
      batchLog.log(JOB, `이메일 추출 실패 msg=${msgId} subject="${subject.slice(0, 60)}"`);
      return { status: "skipped" };
    }

    // 임시보관함에 초안 생성
    const raw = buildDraftRaw(email, config.draftSubject, config.draftBody);
    const res = await fetch(`${GMAIL}/drafts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`초안 생성 실패: ${data.error?.message || res.status}`);

    await setStatus("drafted", email, `draft=${data.id} subject="${subject.slice(0, 100)}"`);
    batchLog.log(JOB, `초안 생성 to=${email} msg=${msgId}`);
    return { status: "drafted" };
  } catch (e) {
    await setStatus("failed", null, e.message).catch(() => {});
    batchLog.error(JOB, `처리 실패 msg=${msgId}: ${e.message}`);
    return { status: "failed" };
  }
}

// ── cron 진입점 ──
// queryOverride: 수동 테스트에서 검색 조건을 바꿀 때만 사용 (scripts/run-autodraft.js)
async function runAutoDraft(queryOverride) {
  await ensureTable();
  const owner = await resolveOwner();
  const fresh = await getFreshAccessToken(owner.id);
  if (!fresh) throw new Error(`토큰 갱신 실패 (${owner.email})`);
  const token = fresh.accessToken;

  const list = await gmailGet(
    token,
    `/messages?q=${encodeURIComponent(queryOverride || config.gmailQuery)}&maxResults=${config.maxPerRun * 2}`
  );
  const ids = (list.messages || []).map((m) => m.id);
  if (!ids.length) return null;

  // 이미 처리한 메일 제외
  const [done] = await db.query(
    `SELECT gmail_msg_id FROM auto_draft_logs WHERE gmail_msg_id IN (?)`,
    [ids]
  );
  const doneSet = new Set(done.map((r) => r.gmail_msg_id));
  const todo = ids.filter((id) => !doneSet.has(id)).slice(0, config.maxPerRun);
  if (!todo.length) return null;

  const counts = { drafted: 0, skipped: 0, failed: 0 };
  for (const id of todo) {
    const r = await processMessage(token, owner.id, id);
    if (r) counts[r.status]++;
  }
  return `초안 ${counts.drafted}건` +
    (counts.skipped ? `, 건너뜀 ${counts.skipped}건` : "") +
    (counts.failed ? `, 실패 ${counts.failed}건` : "");
}

module.exports = { runAutoDraft };
