require("dotenv").config();
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cors = require("cors");
const compression = require("compression");
const scheduler = require("./scheduler");
const db = require("./db");

const app = express();

// 앞단 프록시 단수를 실제보다 크게 잡으면 클라이언트가 X-Forwarded-For 를
// 위조해 req.ip 를 속일 수 있다. 출퇴근의 사무실 IP 판정이 req.ip 에
// 의존하므로, 실제 프록시 수에 맞춰 TRUST_PROXY_HOPS 로 조정할 것.
// (프록시 없이 직접 노출한다면 0 으로 둬야 위조를 막는다)
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

// ── 응답 압축 ──
app.use(compression());

// ── 공통 보안 헤더 ──
const { csrfOriginCheck, securityHeaders } = require("./middleware/security");
const { serverError } = require("./middleware/errors");
app.use(securityHeaders);

// ── CORS ──
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
);

// ── Body Parser ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── 정적 파일 서빙 ──
// 파일명에 해시가 없으므로 캐시 기간은 짧게 두고 ETag 재검증에 의존한다.
// HTML은 항상 재검증(no-cache) → 배포 직후에도 최신 JS/CSS 참조가 보장된다.
const path = require("path");
app.use(
  express.static(path.join(__dirname, "../memo-app"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".html") {
        res.setHeader("Cache-Control", "no-cache");
      } else if (ext === ".js" || ext === ".css") {
        res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      } else {
        // 이미지·폰트 등 거의 바뀌지 않는 정적 자산
        res.setHeader("Cache-Control", "public, max-age=604800");
      }
    },
  }),
);

// ── 세션 (MySQL 저장) ──
// db/index.js 의 커넥션 풀을 그대로 재사용한다. 별도 옵션을 넘기면
// express-mysql-session 이 자체 풀을 하나 더 만들어 커넥션이 두 배로 잡힌다.
// 두 번째 인자로 연결을 넘기면 endConnectionOnClose 가 자동으로 false 가 되어
// 세션 스토어를 닫아도 공용 풀은 유지된다.
const sessionStore = new MySQLStore({}, db.pool);

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 9 * 60 * 60 * 1000, // 9시간
    httpOnly: true,
    // 프런트를 같은 출처에서 서비스하므로 lax 로 충분하다.
    // lax 는 교차 사이트 POST 에 쿠키를 보내지 않아 CSRF 1차 방어가 된다.
    // (none 은 이 방어를 꺼버린다. 프런트를 다른 도메인에 둘 때만
    //  SESSION_SAMESITE=none 으로 바꾸고, 그 경우 secure 는 필수다)
    sameSite: process.env.SESSION_SAMESITE || "lax",
    secure: process.env.NODE_ENV === "production",
  },
});
app.use(sessionMiddleware);

// ── Passport 초기화 ──
app.use(passport.initialize());
app.use(passport.session());

// ── CSRF: 상태 변경 요청의 출처 검증 (라우터보다 먼저) ──
app.use(csrfOriginCheck);

// ── 게스트 계정은 초대받은 채팅 외 기능을 쓸 수 없다 ──
const { blockGuests } = require("./middleware/auth");
app.use(blockGuests);

// ── Google OAuth 전략 ──
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const domain = email.split("@")[1];
        const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "")
          .split(",").map((d) => d.trim()).filter(Boolean);
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
          console.log(`로그인 차단 (허용되지 않은 도메인): ${domain}`);
          return done(null, false, "domain_blocked");
        }

        const [result] = await db.query(
          `INSERT INTO users (google_id, email, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name)`,
          [profile.id, email, profile.displayName],
        );
        const isNew = result.affectedRows === 1 && result.warningStatus === 0;
        const maskedEmail = email.replace(/^[^@]+/, (m) =>
          "*".repeat(m.length),
        );
        console.log(
          isNew
            ? `신규 가입: ${maskedEmail}`
            : `구글로그인 성공: ${maskedEmail}`,
        );
        const [rows] = await db.query(`SELECT * FROM users WHERE google_id=?`, [
          profile.id,
        ]);
        const user = rows[0];
        user.accessToken = accessToken;
        return done(null, user);
      } catch (e) {
        console.error("OAuth DB 저장 오류:", e.message);
        return done(e);
      }
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, { id: user.id, accessToken: user.accessToken });
});

passport.deserializeUser(async ({ id, accessToken }, done) => {
  try {
    const [rows] = await db.query(`SELECT * FROM users WHERE id=?`, [id]);
    if (!rows.length) return done(null, false);
    rows[0].accessToken = accessToken;
    done(null, rows[0]);
  } catch (e) {
    done(e);
  }
});

// ── 채팅 테이블 자동 생성 ──
(async () => {
  await db
    .query(
      `CREATE TABLE IF NOT EXISTS chat_rooms (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) DEFAULT NULL,
    type       ENUM('direct','group') DEFAULT 'direct',
    is_e2ee    TINYINT(1) DEFAULT 0,
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`,
    )
    .catch((e) => console.error("chat_rooms 생성 실패:", e.message));

  await db
    .query(
      `CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id    INT NOT NULL,
    user_id    INT NOT NULL,
    joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
    )
    .catch((e) => console.error("chat_room_members 생성 실패:", e.message));

  await db
    .query(
      `CREATE TABLE IF NOT EXISTS messages (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    room_id     INT NOT NULL,
    from_id     INT NOT NULL,
    content     TEXT,
    file_url    VARCHAR(500) DEFAULT NULL,
    file_name   VARCHAR(255) DEFAULT NULL,
    file_type   VARCHAR(100) DEFAULT NULL,
    is_read      TINYINT(1) DEFAULT 0,
    is_encrypted TINYINT(1) DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_room_created (room_id, created_at),
    KEY idx_room_read (room_id, is_read, from_id),
    FOREIGN KEY (room_id)  REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (from_id)  REFERENCES users(id) ON DELETE CASCADE
  )`,
    )
    .catch((e) => console.error("messages 생성 실패:", e.message));

  // 기존 테이블에 누락된 컬럼 추가
  const [cols] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='messages'`,
    [process.env.DB_NAME],
  );
  const colNames = cols.map((c) => c.COLUMN_NAME);
  if (!colNames.includes("room_id"))
    await db
      .query("ALTER TABLE messages ADD COLUMN room_id INT NOT NULL DEFAULT 0")
      .catch(() => {});
  if (!colNames.includes("file_url"))
    await db
      .query(
        "ALTER TABLE messages ADD COLUMN file_url VARCHAR(500) DEFAULT NULL",
      )
      .catch(() => {});
  if (!colNames.includes("file_name"))
    await db
      .query(
        "ALTER TABLE messages ADD COLUMN file_name VARCHAR(255) DEFAULT NULL",
      )
      .catch(() => {});
  if (!colNames.includes("file_type"))
    await db
      .query(
        "ALTER TABLE messages ADD COLUMN file_type VARCHAR(100) DEFAULT NULL",
      )
      .catch(() => {});
  if (colNames.includes("to_id"))
    await db
      .query("ALTER TABLE messages MODIFY COLUMN to_id INT NULL DEFAULT NULL")
      .catch(() => {});
  if (colNames.includes("content") && !colNames.includes("file_url"))
    await db
      .query("ALTER TABLE messages MODIFY COLUMN content TEXT NULL")
      .catch(() => {});
  if (!colNames.includes("msg_type"))
    await db
      .query(
        "ALTER TABLE messages ADD COLUMN msg_type ENUM('text','system') DEFAULT 'text'",
      )
      .catch(() => {});
  await db
    .query("ALTER TABLE messages MODIFY COLUMN from_id INT NULL DEFAULT NULL")
    .catch(() => {});
  console.log("messages 테이블 컬럼 확인 완료");
  const [roomCols] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='chat_rooms'`,
    [process.env.DB_NAME],
  );
  const roomColNames = roomCols.map((c) => c.COLUMN_NAME);
  if (!roomColNames.includes("is_e2ee"))
    await db
      .query("ALTER TABLE chat_rooms ADD COLUMN is_e2ee TINYINT(1) DEFAULT 0")
      .catch(() => {});
  if (!colNames.includes("is_encrypted"))
    await db
      .query(
        "ALTER TABLE messages ADD COLUMN is_encrypted TINYINT(1) DEFAULT 0",
      )
      .catch(() => {});
})();

// ── 지식베이스 테이블 자동 생성 ──
db.query(
  `CREATE TABLE IF NOT EXISTS user_knowledge_bases (
  user_id    INT NOT NULL PRIMARY KEY,
  content    MEDIUMTEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("user_knowledge_bases 생성 실패:", e.message));

// ── 활동 시간 테이블 자동 생성 ──
db.query(
  `CREATE TABLE IF NOT EXISTS activity_logs (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id  INT NOT NULL,
  log_date DATE NOT NULL,
  minutes  INT DEFAULT 0,
  UNIQUE KEY uq_user_date (user_id, log_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("activity_logs 생성 실패:", e.message));

// ── memo_shares 테이블 자동 생성 ──
db.query(
  `CREATE TABLE IF NOT EXISTS memo_shares (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  memo_id    INT NOT NULL,
  token      VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("memo_shares 테이블 생성 실패:", e.message));

// ── 출퇴근 관리 테이블 자동 생성 ──
(async () => {
  await db
    .query(
      `CREATE TABLE IF NOT EXISTS allowed_ips (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ip_address  VARCHAR(45) NOT NULL UNIQUE,
      description VARCHAR(100) DEFAULT NULL,
      created_by  INT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at  DATETIME DEFAULT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    )`,
    )
    .catch((e) => console.error("allowed_ips 생성 실패:", e.message));

  // 기존 테이블에 deleted_at 컬럼이 없으면 추가
  await db
    .query(
      `ALTER TABLE allowed_ips ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
    )
    .catch(() => {});
  // 기존 테이블에 status 컬럼이 없으면 추가
  await db
    .query(
      `ALTER TABLE allowed_ips ADD COLUMN status ENUM('pending','approved') NOT NULL DEFAULT 'approved'`,
    )
    .catch(() => {});
  // 기존 테이블에 restored_by 컬럼이 없으면 추가
  await db
    .query(`ALTER TABLE allowed_ips ADD COLUMN restored_by INT DEFAULT NULL`)
    .catch(() => {});

  await db
    .query(
      `CREATE TABLE IF NOT EXISTS attendance_requests (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      user_id      INT NOT NULL,
      type         ENUM('in','out') NOT NULL,
      reason       TEXT NOT NULL,
      request_date DATE NOT NULL,
      status       ENUM('pending','approved','rejected') DEFAULT 'pending',
      approver_id  INT DEFAULT NULL,
      approved_at  DATETIME DEFAULT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    )
    .catch((e) => console.error("attendance_requests 생성 실패:", e.message));

  await db
    .query(
      `CREATE TABLE IF NOT EXISTS attendance_records (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      type        ENUM('in','out') NOT NULL,
      clock_time  DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address  VARCHAR(45),
      status      ENUM('normal','pending','approved','rejected') DEFAULT 'normal',
      request_id  INT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (request_id) REFERENCES attendance_requests(id) ON DELETE SET NULL
    )`,
    )
    .catch((e) => console.error("attendance_records 생성 실패:", e.message));
})();

// ── 게시판 테이블 자동 생성 ──
(async () => {
  const [roleCols] = await db
    .query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='role'`,
      [process.env.DB_NAME],
    )
    .catch(() => [[]]);
  if (!roleCols.length) {
    await db
      .query(
        `ALTER TABLE users ADD COLUMN role ENUM('ceo','admin','user') NOT NULL DEFAULT 'user'`,
      )
      .catch((e) => console.error("role 컬럼 추가 실패:", e.message));
    console.log("users.role 컬럼 추가 완료");
  }
  const [guestCols] = await db
    .query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='is_guest'`,
      [process.env.DB_NAME],
    )
    .catch(() => [[]]);
  if (!guestCols.length) {
    await db
      .query(`ALTER TABLE users ADD COLUMN is_guest TINYINT(1) DEFAULT 0`)
      .catch((e) => console.error("is_guest 컬럼 추가 실패:", e.message));
  }
  await db
    .query(
      `CREATE TABLE IF NOT EXISTS posts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    content    TEXT NOT NULL,
    author_id  INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
    )
    .catch((e) => console.error("posts 테이블 생성 실패:", e.message));
})();

// ── 회의록 테이블 자동 생성 ──
(async () => {
  await db
    .query(
      `CREATE TABLE IF NOT EXISTS meeting_minutes (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      title        VARCHAR(200) NOT NULL,
      content      MEDIUMTEXT NOT NULL,
      meeting_date DATETIME NOT NULL,
      location     VARCHAR(200) DEFAULT NULL,
      category     VARCHAR(50)  DEFAULT '일반',
      author_id    INT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    )
    .catch((e) => console.error("meeting_minutes 생성 실패:", e.message));

  await db
    .query(
      `CREATE TABLE IF NOT EXISTS meeting_attendees (
      minute_id INT NOT NULL,
      user_id   INT NOT NULL,
      PRIMARY KEY (minute_id, user_id),
      FOREIGN KEY (minute_id) REFERENCES meeting_minutes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE
    )`,
    )
    .catch((e) => console.error("meeting_attendees 생성 실패:", e.message));
})();

// ── 라우터 ──
const {
  aiLimiter,
  uploadLimiter,
  guestJoinLimiter,
} = require("./middleware/rateLimit");

app.use("/auth", require("./routes/auth"));
app.use("/api/board", require("./routes/board"));
app.use("/api/memos", require("./routes/memos"));
app.use("/api", require("./routes/google"));
app.use("/api/ai", aiLimiter, require("./routes/ai"));
app.use("/api/local", require("./routes/localCalendar"));
app.use("/api/gmail/scheduled", require("./routes/scheduledMail"));
app.use("/api/share", require("./routes/share"));
app.use("/api/report", require("./routes/report"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/minutes", require("./routes/meetingMinutes"));

// ── 누락 인덱스 보정 (멱등, 실패해도 기동은 계속) ──
// 신규 DB 는 CREATE TABLE 의 KEY 정의로 인덱스가 생기고,
// 이미 운영 중인 DB 는 여기서 채워진다.
require("./db/ensure-indexes")
  .ensureIndexes()
  .catch((e) => console.error("인덱스 점검 실패:", e.message));

// ── 메모 엑셀 다운로드 (/api/memos/export/excel 로 위임) ──
// routes/memos.js 의 GET /export/excel 에서 처리

// ── 파일 업로드 (multer) ──
const multer = require("multer");
const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "_" + Math.random().toString(36).slice(2);
    cb(null, unique + path.extname(file.originalname));
  },
});
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
]);
const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".mp4",
  ".webm",
  ".mp3",
  ".ogg",
]);
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("허용되지 않는 파일 형식입니다"));
    }
  },
});

// /uploads 인증된 사용자만 접근 가능
app.get("/uploads/:filename", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const filename = path.basename(req.params.filename);
  const filepath = path.join(__dirname, "uploads", filename);
  res.sendFile(filepath);
});

// ── 헬스체크 ──
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── 공개 설정 키 ──
app.get("/api/config", (req, res) => {
  res.json({ kakaoJsKey: process.env.KAKAO_JS_KEY });
});

// ── 대중교통 길찾기 (Google Directions API 프록시) ──
app.get("/api/maps/transit", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { origin, destination } = req.query;
  if (!origin || !destination)
    return res.status(400).json({ error: "출발지/목적지 필요" });
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}` +
      `&mode=transit&language=ko&region=KR&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    serverError(res, e);
  }
});

// ── 채팅 REST API ──
// 내 룸 목록
app.get("/api/chat/rooms", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [rows] = await db.query(
    `
    SELECT r.id, r.name, r.type, r.is_e2ee, r.created_by,
      (SELECT content FROM messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) AS last_msg,
      (SELECT file_name FROM messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) AS last_file,
      (SELECT created_at FROM messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages WHERE room_id=r.id AND from_id!=? AND is_read=0) AS unread,
      (SELECT GROUP_CONCAT(u.name ORDER BY u.id SEPARATOR ',')
       FROM chat_room_members m JOIN users u ON m.user_id=u.id WHERE m.room_id=r.id) AS member_names,
      (SELECT GROUP_CONCAT(u.id ORDER BY u.id SEPARATOR ',')
       FROM chat_room_members m JOIN users u ON m.user_id=u.id WHERE m.room_id=r.id) AS member_ids
    FROM chat_rooms r
    JOIN chat_room_members me ON me.room_id=r.id AND me.user_id=?
    ORDER BY last_at DESC, r.created_at DESC
  `,
    [req.user.id, req.user.id],
  );
  res.json(rows);
});

// 전체 유저 목록
app.get("/api/chat/users", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [rows] = await db.query(
    `SELECT id, name, email FROM users WHERE id != ? AND is_guest = 0`,
    [req.user.id],
  );
  res.json(rows);
});

// 1:1 룸 생성 or 조회
app.post("/api/chat/rooms/direct/:userId", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const me = req.user.id,
    other = req.params.userId;
  const [existing] = await db.query(
    `
    SELECT r.id FROM chat_rooms r
    JOIN chat_room_members a ON a.room_id=r.id AND a.user_id=?
    JOIN chat_room_members b ON b.room_id=r.id AND b.user_id=?
    WHERE r.type='direct'
    LIMIT 1
  `,
    [me, other],
  );
  if (existing.length) return res.json({ roomId: existing[0].id });
  const [result] = await db.query(
    `INSERT INTO chat_rooms (type, created_by) VALUES ('direct',?)`,
    [me],
  );
  const roomId = result.insertId;
  await db.query(
    `INSERT INTO chat_room_members (room_id, user_id) VALUES (?,?),(?,?)`,
    [roomId, me, roomId, other],
  );
  res.json({ roomId });
});

// 그룹 룸 생성
app.post("/api/chat/rooms/group", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { name, memberIds, isE2ee } = req.body;
  if (!name) return res.status(400).json({ error: "그룹 이름을 입력하세요" });
  const [result] = await db.query(
    `INSERT INTO chat_rooms (name, type, created_by, is_e2ee) VALUES (?,'group',?,?)`,
    [name, req.user.id, isE2ee ? 1 : 0],
  );
  const roomId = result.insertId;
  const allIds = [...new Set([req.user.id, ...(memberIds || [])])];
  await db.query(
    `INSERT INTO chat_room_members (room_id, user_id) VALUES ${allIds.map(() => "(?,?)").join(",")}`,
    allIds.flatMap((id) => [roomId, id]),
  );
  res.json({ roomId });
});

// 메시지 히스토리 (반응 포함)
app.get("/api/chat/rooms/:roomId/messages", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [member] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [req.params.roomId, req.user.id],
  );
  if (!member.length) return res.status(403).json({ error: "권한 없음" });
  const [rows] = await db.query(
    `
    SELECT m.*, u.name AS from_name FROM messages m
    LEFT JOIN users u ON m.from_id=u.id
    WHERE m.room_id=? ORDER BY m.created_at ASC LIMIT 200
  `,
    [req.params.roomId],
  );
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const [reacts] = await db.query(
      `SELECT mr.message_id, mr.emoji, COUNT(*) as cnt,
        GROUP_CONCAT(mr.user_id ORDER BY mr.user_id) as user_ids,
        GROUP_CONCAT(u.name ORDER BY mr.user_id SEPARATOR ',') as user_names
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id IN (?) GROUP BY mr.message_id, mr.emoji`,
      [ids],
    );
    const rMap = {};
    reacts.forEach((r) => {
      if (!rMap[r.message_id]) rMap[r.message_id] = [];
      rMap[r.message_id].push({
        emoji: r.emoji,
        cnt: r.cnt,
        user_ids: r.user_ids,
      });
    });
    rows.forEach((r) => {
      r.reactions = rMap[r.id] || [];
    });
  }
  res.json(rows);
});

// 파일 업로드
app.post("/api/chat/upload", uploadLimiter, (req, res, next) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "파일 없음" });
    const originalName = Buffer.from(req.file.originalname, "latin1").toString(
      "utf8",
    );
    res.json({
      url: `/uploads/${req.file.filename}`,
      name: originalName,
      type: req.file.mimetype,
    });
  });
});

// ── 시스템 메시지 저장 + emit 헬퍼 ──
async function saveAndEmitNotice(roomId, text) {
  await db
    .query(
      `INSERT INTO messages (room_id, from_id, content, msg_type) VALUES (?, NULL, ?, 'system')`,
      [roomId, text],
    )
    .catch(() => {});
  io.to(`room:${roomId}`).emit("room_notice", { roomId: Number(roomId), text });
}

// ── 이모지 반응 테이블 ──
db.query(
  `CREATE TABLE IF NOT EXISTS message_reactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(10) NOT NULL,
  UNIQUE KEY uq (message_id, user_id, emoji),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("message_reactions 생성 실패:", e.message));

// 채팅방 초대 링크 테이블
db.query(
  `CREATE TABLE IF NOT EXISTS chat_invites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  room_id    INT NOT NULL,
  token      VARCHAR(64) NOT NULL UNIQUE,
  created_by INT NOT NULL,
  expires_at DATETIME NOT NULL,
  max_uses   INT DEFAULT NULL,
  use_count  INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id)    REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("chat_invites 생성 실패:", e.message));

// E2EE 공개키 테이블
db.query(
  `CREATE TABLE IF NOT EXISTS user_public_keys (
  user_id    INT NOT NULL PRIMARY KEY,
  public_key MEDIUMTEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("user_public_keys 생성 실패:", e.message));

// E2EE 룸키 테이블 (멤버별 RSA로 래핑된 AES 룸키)
db.query(
  `CREATE TABLE IF NOT EXISTS room_e2ee_keys (
  room_id       INT NOT NULL,
  user_id       INT NOT NULL,
  encrypted_key MEDIUMTEXT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
).catch((e) => console.error("room_e2ee_keys 생성 실패:", e.message));

// 룸 멤버 조회
app.get("/api/chat/rooms/:roomId/members", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [member] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [req.params.roomId, req.user.id],
  );
  if (!member.length) return res.status(403).json({ error: "권한 없음" });
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email FROM chat_room_members m
     JOIN users u ON m.user_id=u.id WHERE m.room_id=?`,
    [req.params.roomId],
  );
  res.json(rows);
});

// 그룹 멤버 추가
app.post("/api/chat/rooms/:roomId/members", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { userIds } = req.body;
  const roomId = req.params.roomId;
  const [room] = await db.query(
    `SELECT created_by, type FROM chat_rooms WHERE id=?`,
    [roomId],
  );
  if (!room.length || room[0].type !== "group")
    return res.status(400).json({ error: "그룹만 가능" });
  const [isMember] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [roomId, req.user.id],
  );
  if (!isMember.length) return res.status(403).json({ error: "권한 없음" });
  for (const uid of userIds) {
    await db.query(
      `INSERT IGNORE INTO chat_room_members (room_id, user_id) VALUES (?,?)`,
      [roomId, uid],
    );
    const [newMember] = await db.query(
      `SELECT name, email FROM users WHERE id=?`,
      [uid],
    );
    if (newMember.length) {
      const name = newMember[0].name || newMember[0].email;
      await saveAndEmitNotice(roomId, `${name}님이 초대되었습니다.`);
    }
  }
  res.json({ ok: true });
});

// 그룹 멤버 추방 (방장만)
app.delete("/api/chat/rooms/:roomId/members/:userId", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const roomId = req.params.roomId;
  const [room] = await db.query(
    `SELECT created_by FROM chat_rooms WHERE id=?`,
    [roomId],
  );
  if (!room.length || room[0].created_by !== req.user.id)
    return res.status(403).json({ error: "방장만 가능" });
  const [target] = await db.query(`SELECT name, email FROM users WHERE id=?`, [
    req.params.userId,
  ]);
  await db.query(
    `DELETE FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [roomId, req.params.userId],
  );
  if (target.length) {
    const name = target[0].name || target[0].email;
    await saveAndEmitNotice(
      roomId,
      `방장에 의해 ${name}님이 강제퇴장 되었습니다.`,
    );
  }
  res.json({ ok: true });
});

// 채팅방 나가기
app.delete("/api/chat/rooms/:roomId/leave", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const roomId = req.params.roomId;
  const name = req.user.name || req.user.email;
  await db.query(
    `DELETE FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [roomId, req.user.id],
  );
  await saveAndEmitNotice(roomId, `${name}님이 채팅방을 나갔습니다.`);
  res.json({ ok: true });
});

// 메시지 검색
app.get("/api/chat/rooms/:roomId/search", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [member] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [req.params.roomId, req.user.id],
  );
  if (!member.length) return res.status(403).json({ error: "권한 없음" });
  const q = `%${(req.query.q || "").replace(/[%_\\]/g, "\\$&")}%`;
  const [rows] = await db.query(
    `
    SELECT m.id, m.content, m.created_at, u.name AS from_name FROM messages m
    JOIN users u ON m.from_id=u.id
    WHERE m.room_id=? AND m.content LIKE ? ESCAPE '\\'
    ORDER BY m.created_at DESC LIMIT 50
  `,
    [req.params.roomId, q],
  );
  res.json(rows);
});

// 이모지 반응 토글
app.post("/api/chat/messages/:messageId/reactions", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: "emoji 필요" });
  const messageId = Number(req.params.messageId);
  const userId = req.user.id;
  const [ex] = await db.query(
    `SELECT id FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?`,
    [messageId, userId, emoji],
  );
  if (ex.length) {
    await db.query(
      `DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?`,
      [messageId, userId, emoji],
    );
  } else {
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?)`,
      [messageId, userId, emoji],
    );
  }
  const [reactions] = await db.query(
    `SELECT mr.emoji, COUNT(*) as cnt,
      GROUP_CONCAT(mr.user_id ORDER BY mr.user_id) as user_ids,
      GROUP_CONCAT(u.name ORDER BY mr.user_id SEPARATOR ',') as user_names
     FROM message_reactions mr
     JOIN users u ON mr.user_id = u.id
     WHERE mr.message_id=? GROUP BY mr.emoji`,
    [messageId],
  );
  const [msg] = await db.query(`SELECT room_id FROM messages WHERE id=?`, [
    messageId,
  ]);
  if (msg.length) {
    io.to(`room:${msg[0].room_id}`).emit("reaction_updated", {
      messageId,
      reactions,
    });
  }
  res.json({ reactions });
});

// ── 초대 링크 ──
app.post("/api/chat/rooms/:roomId/invite", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const roomId = req.params.roomId;
  const [member] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [roomId, req.user.id],
  );
  if (!member.length) return res.status(403).json({ error: "권한 없음" });
  const [room] = await db.query(`SELECT type FROM chat_rooms WHERE id=?`, [
    roomId,
  ]);
  if (!room.length || room[0].type !== "group")
    return res.status(400).json({ error: "그룹 채팅방만 가능합니다" });
  const token = require("crypto").randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); //초대링크 유효기간
  await db.query(
    `INSERT INTO chat_invites (room_id, token, created_by, expires_at) VALUES (?,?,?,?)`,
    [roomId, token, req.user.id, expiresAt],
  );
  res.json({ token });
});

app.get("/api/chat/invite/:token", async (req, res) => {
  const [rows] = await db.query(
    `
    SELECT ci.room_id, cr.name AS room_name, u.name AS inviter_name
    FROM chat_invites ci
    JOIN chat_rooms cr ON ci.room_id=cr.id
    JOIN users u ON ci.created_by=u.id
    WHERE ci.token=? AND ci.expires_at > NOW() AND (ci.max_uses IS NULL OR ci.use_count < ci.max_uses)
  `,
    [req.params.token],
  );
  if (!rows.length)
    return res.status(404).json({ error: "유효하지 않은 초대 링크입니다" });
  res.json({
    roomId: rows[0].room_id,
    roomName: rows[0].room_name,
    inviterName: rows[0].inviter_name,
  });
});

app.post("/api/chat/invite/:token/join", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [rows] = await db.query(
    `
    SELECT * FROM chat_invites
    WHERE token=? AND expires_at > NOW() AND (max_uses IS NULL OR use_count < max_uses)
  `,
    [req.params.token],
  );
  if (!rows.length)
    return res.status(400).json({ error: "유효하지 않은 초대 링크입니다" });
  const invite = rows[0];
  const [already] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [invite.room_id, req.user.id],
  );
  if (!already.length) {
    await db.query(
      `INSERT INTO chat_room_members (room_id, user_id) VALUES (?,?)`,
      [invite.room_id, req.user.id],
    );
    await db.query(`UPDATE chat_invites SET use_count=use_count+1 WHERE id=?`, [
      invite.id,
    ]);
    await saveAndEmitNotice(
      invite.room_id,
      `${req.user.name || req.user.email}님이 초대 링크로 참여했습니다.`,
    );
    const userSocketId = onlineUsers.get(String(req.user.id));
    if (userSocketId) {
      const userSocket = io.sockets.sockets.get(userSocketId);
      if (userSocket) userSocket.join(`room:${invite.room_id}`);
    }
    const [eRoom] = await db.query(
      `SELECT is_e2ee FROM chat_rooms WHERE id=?`,
      [invite.room_id],
    );
    if (eRoom[0]?.is_e2ee) {
      io.to(`room:${invite.room_id}`).emit("e2ee_key_request", {
        roomId: invite.room_id,
        newUserId: req.user.id,
      });
    }
  }
  res.json({ roomId: invite.room_id });
});

// 게스트로 참여 (로그인 없이 이름만 입력)
// 비로그인 상태로 users 행을 만드는 유일한 경로라 레이트리밋이 필수다.
app.post("/api/chat/invite/:token/guest-join", guestJoinLimiter, async (req, res) => {
  const [rows] = await db.query(
    `
    SELECT * FROM chat_invites
    WHERE token=? AND expires_at > NOW() AND (max_uses IS NULL OR use_count < max_uses)
  `,
    [req.params.token],
  );
  if (!rows.length)
    return res.status(400).json({ error: "유효하지 않은 초대 링크입니다" });
  const invite = rows[0];

  const guestName = String(req.body.guestName || "").trim();
  if (!guestName) return res.status(400).json({ error: "이름을 입력하세요" });
  if (guestName.length > 20)
    return res.status(400).json({ error: "이름은 20자 이하로 입력하세요" });

  const uid = require("crypto").randomBytes(12).toString("hex");
  const [result] = await db.query(
    `INSERT INTO users (google_id, email, name, is_guest) VALUES (?,?,?,1)`,
    [`guest_${uid}`, `guest_${uid}@guest.local`, guestName],
  );
  const guestUserId = result.insertId;

  await db.query(
    `INSERT IGNORE INTO chat_room_members (room_id, user_id) VALUES (?,?)`,
    [invite.room_id, guestUserId],
  );
  await db.query(`UPDATE chat_invites SET use_count=use_count+1 WHERE id=?`, [
    invite.id,
  ]);
  await saveAndEmitNotice(
    invite.room_id,
    `${guestName}님이 초대 링크로 참여했습니다.`,
  );

  req.login({ id: guestUserId, accessToken: null }, (err) => {
    if (err) return res.status(500).json({ error: "세션 생성 실패" });
    res.json({ roomId: invite.room_id });
  });
});

// ── E2EE 키 관리(암호화채팅 기능) ──
app.post("/api/chat/keys/register", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: "publicKey 필요" });
  await db.query(
    `INSERT INTO user_public_keys (user_id, public_key) VALUES (?,?) ON DUPLICATE KEY UPDATE public_key=VALUES(public_key)`,
    [req.user.id, publicKey],
  );
  res.json({ ok: true });
});

app.get("/api/chat/users/public-keys", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const userIds = (req.query.ids || "").split(",").map(Number).filter(Boolean);
  if (!userIds.length) return res.json({});
  const [rows] = await db.query(
    `SELECT user_id, public_key FROM user_public_keys WHERE user_id IN (?)`,
    [userIds],
  );
  const result = {};
  rows.forEach((r) => {
    result[r.user_id] = r.public_key;
  });
  res.json(result);
});

app.get("/api/chat/rooms/:roomId/e2ee-key", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const [rows] = await db.query(
    `SELECT encrypted_key FROM room_e2ee_keys WHERE room_id=? AND user_id=?`,
    [req.params.roomId, req.user.id],
  );
  res.json({ key: rows[0]?.encrypted_key || null });
});

app.post("/api/chat/rooms/:roomId/e2ee-keys", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "미로그인" });
  const { keys } = req.body;
  const roomId = req.params.roomId;
  const [member] = await db.query(
    `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
    [roomId, req.user.id],
  );
  if (!member.length) return res.status(403).json({ error: "권한 없음" });
  for (const [userId, encryptedKey] of Object.entries(keys)) {
    await db.query(
      `INSERT INTO room_e2ee_keys (room_id, user_id, encrypted_key) VALUES (?,?,?) ON DUPLICATE KEY UPDATE encrypted_key=VALUES(encrypted_key)`,
      [roomId, Number(userId), encryptedKey],
    );
  }
  res.json({ ok: true });
});

// ── 전역 에러 핸들러 (모든 라우터 뒤에 위치해야 한다) ──
app.use((err, req, res, next) => {
  console.error(`요청 처리 오류 [${req.method} ${req.originalUrl}]:`, err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: "서버 오류가 발생했습니다" });
});

// ── 서버 시작 (Socket.io) ──
const http = require("http");
const { Server } = require("socket.io");
const PORT = process.env.PORT || 4000;
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
});

// 세션 미들웨어를 핸드셰이크에 적용 → 로그인 사용자만 소켓 연결 허용
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sessUserId = socket.request.session?.passport?.user?.id;
  if (!sessUserId) return next(new Error("unauthorized"));
  socket.data.userId = String(sessUserId);
  next();
});

const onlineUsers = new Map(); // userId → socketId

io.on("connection", (socket) => {
  // 클라이언트가 보낸 값이 아닌 세션에서 검증된 userId만 사용
  const userId = socket.data.userId;

  onlineUsers.set(userId, socket.id);
  io.emit("online_users", Array.from(onlineUsers.keys()));

  // 내 룸들에 join
  (async () => {
    const [rooms] = await db.query(
      `SELECT room_id FROM chat_room_members WHERE user_id=?`,
      [userId],
    );
    rooms.forEach((r) => socket.join(`room:${r.room_id}`));
  })();

  // 메시지 전송
  socket.on(
    "send_message",
    async ({ roomId, content, fileUrl, fileName, fileType, isEncrypted }) => {
      if (!content?.trim() && !fileUrl) return;
      // fileUrl은 업로드 엔드포인트가 생성한 경로 형식만 허용 (저장형 XSS 방지)
      if (fileUrl && !/^\/uploads\/[A-Za-z0-9_]+\.[A-Za-z0-9]+$/.test(fileUrl))
        return;
      const [member] = await db.query(
        `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
        [roomId, userId],
      );
      if (!member.length) return;
      try {
        const [result] = await db.query(
          `INSERT INTO messages (room_id, from_id, content, file_url, file_name, file_type, is_encrypted) VALUES (?,?,?,?,?,?,?)`,
          [
            roomId,
            userId,
            content?.trim() || null,
            fileUrl || null,
            fileName || null,
            fileType || null,
            isEncrypted ? 1 : 0,
          ],
        );
        const [rows] = await db.query(
          `SELECT m.*, u.name AS from_name FROM messages m JOIN users u ON m.from_id=u.id WHERE m.id=?`,
          [result.insertId],
        );
        io.to(`room:${roomId}`).emit("new_message", { roomId, msg: rows[0] });
      } catch (e) {
        console.error("메시지 저장 오류:", e.message);
      }
    },
  );

  // 읽음 처리
  socket.on("mark_read", async ({ roomId }) => {
    const [member] = await db.query(
      `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
      [roomId, userId],
    );
    if (!member.length) return;
    await db.query(
      `UPDATE messages SET is_read=1 WHERE room_id=? AND from_id!=? AND is_read=0`,
      [roomId, userId],
    );
    socket.to(`room:${roomId}`).emit("messages_read", { roomId, byId: userId });
  });

  // 메시지 삭제 (본인이 보낸 메시지만)
  socket.on("delete_message", async ({ messageId }) => {
    const [rows] = await db.query(
      `SELECT room_id, from_id FROM messages WHERE id=?`,
      [messageId],
    );
    if (!rows.length) return;
    if (String(rows[0].from_id) !== userId) return;
    const roomId = rows[0].room_id;
    await db.query(`DELETE FROM messages WHERE id=?`, [messageId]);
    io.to(`room:${roomId}`).emit("message_deleted", { roomId, messageId });
  });

  socket.on("request_e2ee_key", async ({ roomId }) => {
    const [member] = await db.query(
      `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`,
      [roomId, userId],
    );
    if (!member.length) return;
    socket.to(`room:${roomId}`).emit("e2ee_key_request", {
      roomId: Number(roomId),
      newUserId: Number(userId),
    });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(userId);
    io.emit("online_users", Array.from(onlineUsers.keys()));
  });
});

httpServer.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

// ── Graceful shutdown ──
// PM2 는 재시작/중지 시 SIGINT 을 보내고 kill_timeout 후 SIGKILL 한다.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} 수신 → 종료 절차 시작`);

  // 정리가 멈춰도 프로세스가 남지 않도록 강제 종료 타이머를 건다.
  const forceExit = setTimeout(() => {
    console.error("정상 종료 시간 초과 → 강제 종료");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await scheduler.stopAll(); // 새 cron 실행 중단
    await new Promise((resolve) => io.close(resolve)); // 소켓 + httpServer 종료
    await sessionStore.close();
    await db.end(); // 공용 커넥션 풀 반납
    console.log("정상 종료 완료");
    clearTimeout(forceExit);
    process.exit(0);
  } catch (e) {
    console.error("종료 처리 중 오류:", e);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Windows 에서는 POSIX 시그널이 전달되지 않는다.
// PM2 의 shutdown_with_message 옵션이 대신 IPC 메시지를 보낸다.
process.on("message", (msg) => {
  if (msg === "shutdown") shutdown("shutdown message");
});

// ── 프로세스 레벨 에러 핸들러 ──
// 이전에는 소켓 핸들러의 await 실패 하나로 프로세스 전체가 내려갔다.
process.on("unhandledRejection", (reason) => {
  console.error("처리되지 않은 Promise 거부:", reason);
});

// uncaughtException 이후의 상태는 신뢰할 수 없으므로
// 로그만 남기고 정상 종료 → PM2 가 재시작하게 한다.
process.on("uncaughtException", (err) => {
  console.error("처리되지 않은 예외:", err);
  shutdown("uncaughtException");
});
