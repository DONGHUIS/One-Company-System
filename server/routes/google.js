// Google API 프록시 라우터
// 브라우저 대신 서버가 Google API 호출 (토큰 노출 방지)
const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");
const { ensureGoogleToken } = require("../lib/googleTokens");

// 이 라우터는 /api 전체에 마운트되므로, Google API 경로에서만
// 액세스 토큰 만료 검사·갱신을 수행한다.
const GOOGLE_PATHS = /^\/(gmail|drive|calendar|tasks)(\/|$)/;
router.use((req, res, next) =>
  GOOGLE_PATHS.test(req.path) ? ensureGoogleToken(req, res, next) : next(),
);

async function googleFetch(url, options, token) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
}

// query 객체를 URL 파라미터 문자열로 변환 (배열 값도 지원)
function queryToString(query) {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (Array.isArray(val)) {
      val.forEach((v) => params.append(key, v));
    } else {
      params.append(key, val);
    }
  }
  return params.toString();
}

// ── Gmail ──
router.get("/gmail/inbox", requireAuth, async (req, res) => {
  try {
    const { pageToken } = req.query;
    const qs = new URLSearchParams({ maxResults: "10", labelIds: "INBOX" });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/gmail/sent", requireAuth, async (req, res) => {
  try {
    const { pageToken } = req.query;
    const qs = new URLSearchParams({ maxResults: "10", labelIds: "SENT" });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/gmail/cc", requireAuth, async (req, res) => {
  try {
    const { pageToken } = req.query;
    const qs = new URLSearchParams({ maxResults: "10", q: "cc:me" });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.get("/gmail/search", requireAuth, async (req, res) => {
  try {
    const { q, pageToken } = req.query;
    if (!q) return res.status(400).json({ error: "검색어가 없습니다." });
    const qs = new URLSearchParams({ maxResults: "10", q });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/gmail/messages/:id", requireAuth, async (req, res) => {
  try {
    const qs = queryToString(req.query);
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}${qs ? "?" + qs : "?format=full"}`;
    const r = await googleFetch(url, {}, req.user.accessToken);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/gmail/attachments/:msgId/:attachmentId", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.msgId}/attachments/${req.params.attachmentId}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/gmail/labels/INBOX", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/gmail/send", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { method: "POST", body: JSON.stringify(req.body) },
      req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Calendar ──
router.get("/calendar/events", requireAuth, async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/calendar/events", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      { method: "POST", body: JSON.stringify(req.body) },
      req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/calendar/events/:id", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${req.params.id}`,
      { method: "PATCH", body: JSON.stringify(req.body) },
      req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/calendar/events/:id", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${req.params.id}`,
      { method: "DELETE" },
      req.user.accessToken
    );
    res.status(r.status).json({ ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Drive ──
router.get("/drive/files", requireAuth, async (req, res) => {
  try {
    const params = queryToString(req.query);
    const r = await googleFetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/drive/upload", requireAuth, async (req, res) => {
  try {
    const { name, mimeType, b64, folderId } = req.body;
    const fileBuffer = Buffer.from(b64, "base64");
    const boundary = "UploadBoundary" + Date.now();
    const metadata = JSON.stringify({ name, parents: [folderId || "root"] });

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const r = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.user.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Tasks ──
router.get("/tasks/lists", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20",
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/tasks/:listId", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${req.params.listId}/tasks?showCompleted=true&maxResults=50`,
      {}, req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/tasks/:listId/tasks", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${req.params.listId}/tasks`,
      { method: "POST", body: JSON.stringify(req.body) },
      req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/tasks/:listId/tasks/:taskId", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${req.params.listId}/tasks/${req.params.taskId}`,
      { method: "PATCH", body: JSON.stringify(req.body) },
      req.user.accessToken
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/tasks/:listId/tasks/:taskId", requireAuth, async (req, res) => {
  try {
    const r = await googleFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${req.params.listId}/tasks/${req.params.taskId}`,
      { method: "DELETE" },
      req.user.accessToken
    );
    res.status(r.status).json({ ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
