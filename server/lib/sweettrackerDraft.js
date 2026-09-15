// ── 스마트택배 로그인 문의 자동 초안 생성 ──
//
// Jira 초안(autoDraft.js)과 같은 골격이지만, 스마트택배 문의 메일은
// 형식이 고정되어 있어("사용자 이메일 x@y.z ... 문의 내용 ...") AI 없이
// 정규식 파싱과 키워드 매칭만으로 처리한다. 비용 없이 결정적으로 동작한다.
//
// 흐름:
//   1. Gmail 에서 "스마트택배 문의처리" 라벨의 미읽음 메일 검색 (config.gmailQuery)
//   2. 본문에서 "사용자 이메일"과 "문의 내용"을 추출
//   3. 문의 내용에 로그인 키워드가 있으면 쇼핑몰별 규칙(config.rules)으로
//      템플릿을 골라 해당 메일의 답장 초안을 임시보관함에 생성 — 발송은 하지 않는다.
//   4. sweettracker_draft_logs 에 기록하고, gmail.modify 스코프가 있으면
//      처리 완료 라벨(config.processedLabelName)도 붙인다.
//
// 수동 실행 전용: scripts/run-sweettracker-draft.js 참고. cron 에는 걸지 않는다.

const db = require("../db");
const batchLog = require("./batchLog");
const { getFreshAccessToken } = require("./googleTokens");
const config = require("../config/sweettrackerDraft");

const JOB = "스마트택배초안";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS sweettracker_draft_logs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      gmail_msg_id VARCHAR(32) NOT NULL UNIQUE,
      user_id      INT NOT NULL,
      status       ENUM('processing','drafted','skipped','failed') NOT NULL DEFAULT 'processing',
      to_addr      VARCHAR(255),
      rule_name    VARCHAR(50),
      detail       VARCHAR(500),
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  tableReady = true;
}

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
  throw new Error("Google 연동 사용자가 여럿입니다 — SWEETTRACKER_OWNER_EMAIL 환경변수로 지정하세요");
}

// ── Gmail 유틸 ──
async function gmailReq(token, path, init = {}) {
  const res = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gmail ${path}: ${data.error?.message || res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const toB64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function walkParts(part, out) {
  if (!part) return;
  const mime = part.mimeType || "";
  if (mime === "text/plain" && part.body?.data) {
    out.text += fromB64url(part.body.data).toString("utf8") + "\n";
  } else if (mime === "text/html" && part.body?.data) {
    out.html += fromB64url(part.body.data).toString("utf8");
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

// ── 본문 파싱 ──
// 스마트택배 알림 형식: "... 사용자 이메일 x@y.z 문의 내용 <내용> [첨부 이미지 ...] 이 메일은 스마트택배 ..."
function parseInquiry(bodyText) {
  const emailMatch = bodyText.match(/사용자\s*이메일\s*:?\s*([^\s@]+@[^\s@]+\.[^\s@]+)/);
  const inquiryMatch = bodyText.match(
    /문의\s*내용\s*:?\s*([\s\S]*?)(?=첨부\s*이미지|이\s*메일은\s*스마트\s*택배|이\s*메일은\s*스마트택배|$)/
  );
  return {
    userEmail: emailMatch ? emailMatch[1].trim() : null,
    inquiry: inquiryMatch ? inquiryMatch[1].trim() : "",
  };
}

const isLoginInquiry = (inquiry) =>
  config.loginKeywords.some((k) => inquiry.includes(k));

const pickRule = (inquiry) =>
  config.rules.find((r) => r.keywords.some((k) => inquiry.includes(k))) ||
  config.defaultRule;

// ── 답장 초안 MIME 생성 ──
const encodeHeader = (s) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

function buildReplyRaw({ to, subject, body, inReplyTo }) {
  const b64body = Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  }
  lines.push(
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64body
  );
  return toB64url(Buffer.from(lines.join("\r\n"), "utf8"));
}

// ── 처리 완료 라벨 ──
// 조회는 gmail.readonly 로 가능하지만 생성/부착은 gmail.modify 가 필요하다.
// 스코프가 없으면 경고만 남기고 DB 기록으로만 중복을 막는다.
async function findProcessedLabelId(token) {
  const data = await gmailReq(token, `/labels`);
  const label = (data.labels || []).find((l) => l.name === config.processedLabelName);
  if (label) return label.id;
  // 없으면 생성 시도 (gmail.modify 스코프 필요 — 없으면 라벨 없이 진행)
  try {
    const created = await gmailReq(token, `/labels`, {
      method: "POST",
      body: JSON.stringify({
        name: config.processedLabelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    return created.id;
  } catch {
    return null;
  }
}

async function tryAttachLabel(token, msgId, labelId, warnOnce) {
  if (!labelId) return;
  try {
    await gmailReq(token, `/messages/${msgId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  } catch (e) {
    if (e.status === 403 && !warnOnce.done) {
      warnOnce.done = true;
      batchLog.log(JOB, `라벨 부착 권한 없음(gmail.modify 스코프 필요) — DB 기록으로만 중복 방지`);
    } else if (e.status !== 403) {
      batchLog.error(JOB, `라벨 부착 실패 msg=${msgId}: ${e.message}`);
    }
  }
}

// ── 메일 1건 처리 ──
async function processMessage(token, userId, msgId, processedLabelId, warnOnce) {
  const [claim] = await db.query(
    `INSERT IGNORE INTO sweettracker_draft_logs (gmail_msg_id, user_id) VALUES (?,?)`,
    [msgId, userId]
  );
  if (!claim.affectedRows) return null;

  const setStatus = (status, toAddr, ruleName, detail) =>
    db.query(
      `UPDATE sweettracker_draft_logs SET status=?, to_addr=?, rule_name=?, detail=? WHERE gmail_msg_id=?`,
      [status, toAddr, ruleName, String(detail || "").slice(0, 500), msgId]
    );

  try {
    const full = await gmailReq(token, `/messages/${msgId}?format=full`);

    // 세션(Claude)에서 수동 처리하며 이미 라벨을 붙인 메일은 건너뛴다
    if (processedLabelId && (full.labelIds || []).includes(processedLabelId)) {
      await setStatus("skipped", null, null, "처리 완료 라벨 있음");
      return { status: "skipped", msgId };
    }

    const headers = Object.fromEntries(
      (full.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
    );
    const out = { text: "", html: "" };
    walkParts(full.payload, out);
    const bodyText = out.text || stripHtml(out.html);

    const { userEmail, inquiry } = parseInquiry(bodyText);
    if (!inquiry) {
      await setStatus("skipped", null, null, "문의 내용 파싱 실패");
      return { status: "skipped", msgId };
    }
    if (!isLoginInquiry(inquiry)) {
      await setStatus("skipped", null, null, `로그인 문의 아님: ${inquiry.slice(0, 80)}`);
      return { status: "skipped", msgId };
    }
    if (!userEmail) {
      await setStatus("skipped", null, null, "사용자 이메일 추출 실패");
      batchLog.log(JOB, `이메일 추출 실패 msg=${msgId}`);
      return { status: "skipped", msgId };
    }

    const rule = pickRule(inquiry);
    const raw = buildReplyRaw({
      to: userEmail,
      subject: rule.subject,
      body: rule.body,
      inReplyTo: headers["message-id"] || null,
    });
    const data = await gmailReq(token, `/drafts`, {
      method: "POST",
      body: JSON.stringify({ message: { raw, threadId: full.threadId } }),
    });

    await tryAttachLabel(token, msgId, processedLabelId, warnOnce);
    await setStatus("drafted", userEmail, rule.name, `draft=${data.id} 문의="${inquiry.slice(0, 100)}"`);
    batchLog.log(JOB, `초안 생성 [${rule.name}] to=${userEmail} msg=${msgId}`);
    return { status: "drafted", msgId, rule: rule.name, to: userEmail };
  } catch (e) {
    await setStatus("failed", null, null, e.message).catch(() => {});
    batchLog.error(JOB, `처리 실패 msg=${msgId}: ${e.message}`);
    return { status: "failed", msgId };
  }
}

// ── 수동 실행 진입점 ──
// queryOverride: 검색 조건을 바꿔 실행할 때만 사용 (scripts/run-sweettracker-draft.js)
async function runSweettrackerDraft(queryOverride) {
  await ensureTable();
  const owner = await resolveOwner();
  const fresh = await getFreshAccessToken(owner.id);
  if (!fresh) throw new Error(`토큰 갱신 실패 (${owner.email})`);
  const token = fresh.accessToken;

  const processedLabelId = await findProcessedLabelId(token);
  const list = await gmailReq(
    token,
    `/messages?q=${encodeURIComponent(queryOverride || config.gmailQuery)}&maxResults=${config.maxPerRun * 2}`
  );
  const ids = (list.messages || []).map((m) => m.id);
  if (!ids.length) return { summary: "처리할 새 메일 없음", results: [] };

  const [done] = await db.query(
    `SELECT gmail_msg_id FROM sweettracker_draft_logs WHERE gmail_msg_id IN (?)`,
    [ids]
  );
  const doneSet = new Set(done.map((r) => r.gmail_msg_id));
  const todo = ids.filter((id) => !doneSet.has(id)).slice(0, config.maxPerRun);
  if (!todo.length) return { summary: "처리할 새 메일 없음 (모두 처리 이력 있음)", results: [] };

  const warnOnce = { done: false };
  const counts = { drafted: 0, skipped: 0, failed: 0 };
  const results = [];
  for (const id of todo) {
    const r = await processMessage(token, owner.id, id, processedLabelId, warnOnce);
    if (r) {
      counts[r.status]++;
      results.push(r);
    }
  }
  const summary =
    `초안 ${counts.drafted}건` +
    (counts.skipped ? `, 건너뜀 ${counts.skipped}건` : "") +
    (counts.failed ? `, 실패 ${counts.failed}건` : "");
  return { summary, results };
}

module.exports = { runSweettrackerDraft };
