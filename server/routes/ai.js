const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");
const Anthropic = require("@anthropic-ai/sdk");
const db = require("../db");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post("/summarize-email", requireAuth, async (req, res) => {
  const { subject, from, body } = req.body;
  if (!body && !subject) return res.status(400).json({ error: "내용이 없습니다" });

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `다음 이메일을 한국어로 핵심만 3~5줄로 자연스럽게 요약해줘. 번호나 불릿 없이 문장으로.\n\n제목: ${subject || "(없음)"}\n보낸 사람: ${from || "(없음)"}\n\n${body}`,
        },
      ],
    });

    const summary = message.content[0].text;
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/knowledge-base", requireAuth, async (req, res) => {
  const [rows] = await db.query(
    `SELECT content FROM user_knowledge_bases WHERE user_id=?`,
    [req.user.id]
  );
  res.json({ content: rows[0]?.content || "" });
});

router.put("/knowledge-base", requireAuth, async (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: "content 필요" });
  await db.query(
    `INSERT INTO user_knowledge_bases (user_id, content) VALUES (?,?)
     ON DUPLICATE KEY UPDATE content=?, updated_at=NOW()`,
    [req.user.id, content, content]
  );
  res.json({ ok: true });
});

router.post("/chat", requireAuth, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "messages 필요" });

  const [rows] = await db.query(
    `SELECT content FROM user_knowledge_bases WHERE user_id=?`,
    [req.user.id]
  );
  const kb = rows[0]?.content || "";

  try {
    const params = {
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages,
    };
    if (kb) params.system = kb;

    const message = await client.messages.create(params);
    res.json({ reply: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
