const db = require("./index");

// 운영 중인 DB 에 누락된 인덱스를 채워 넣는다.
//
// schema.sql / CREATE TABLE 에 KEY 를 적어두어도 이미 만들어진 테이블에는
// 반영되지 않는다. 실제로 messages.room_id 는 ALTER TABLE ADD COLUMN 으로
// 나중에 추가된 컬럼이라 인덱스가 붙지 않은 채 운영되고 있었다.
// 서버 기동 시 한 번 실행되며, 이미 있으면 아무 것도 하지 않는다.

const INDEXES = [
  // ── 채팅 ──
  // 방 목록의 마지막 메시지 조회, 대화 내역 200건 로드, 메시지 검색
  // 모두 room_id 로 좁히고 created_at 으로 정렬한다.
  {
    table: "messages",
    name: "idx_room_created",
    columns: ["room_id", "created_at"],
  },
  // 안 읽은 메시지 수 집계와 읽음 처리 UPDATE
  // (WHERE room_id=? AND from_id!=? AND is_read=0)
  {
    table: "messages",
    name: "idx_room_read",
    columns: ["room_id", "is_read", "from_id"],
  },

  // ── 세션 ──
  // express-mysql-session 이 15분마다 DELETE ... WHERE expires < ? 를 돌린다.
  { table: "sessions", name: "idx_expires", columns: ["expires"] },

  // ── 예약 메일 ──
  // 매분 도는 cron 의 선점 UPDATE (WHERE status='pending' AND scheduled_at <= NOW())
  {
    table: "scheduled_emails",
    name: "idx_status_scheduled",
    columns: ["status", "scheduled_at"],
  },

  // ── 메모 ──
  // 목록: WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC
  // 휴지통: WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC
  {
    table: "memos",
    name: "idx_user_deleted_created",
    columns: ["user_id", "deleted_at", "created_at"],
  },
  // 자정 cron: WHERE deleted_at IS NOT NULL AND deleted_at <= NOW() - INTERVAL 15 DAY
  // (user_id 로 시작하는 위 인덱스는 이 조건에 쓸 수 없다)
  { table: "memos", name: "idx_deleted_at", columns: ["deleted_at"] },
];

async function tableExists(schema, table) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1`,
    [schema, table],
  );
  return rows.length > 0;
}

async function columnNames(schema, table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [schema, table],
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function indexExists(schema, table, name) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
    [schema, table, name],
  );
  return rows.length > 0;
}

async function ensureIndexes({ verbose = false } = {}) {
  const schema = process.env.DB_NAME;
  if (!schema) throw new Error("DB_NAME 환경변수가 없습니다");

  const created = [];
  const skipped = [];

  for (const idx of INDEXES) {
    try {
      if (!(await tableExists(schema, idx.table))) {
        skipped.push(`${idx.table}.${idx.name} (테이블 없음)`);
        continue;
      }
      if (await indexExists(schema, idx.table, idx.name)) {
        skipped.push(`${idx.table}.${idx.name} (이미 존재)`);
        continue;
      }
      const cols = await columnNames(schema, idx.table);
      const missing = idx.columns.filter((c) => !cols.has(c));
      if (missing.length) {
        skipped.push(`${idx.table}.${idx.name} (컬럼 없음: ${missing})`);
        continue;
      }

      // 식별자는 코드에 하드코딩된 상수라 바인딩 없이 조립해도 안전하다.
      const colList = idx.columns.map((c) => `\`${c}\``).join(", ");
      await db.query(
        `ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` (${colList})`,
      );
      created.push(`${idx.table}.${idx.name} (${idx.columns.join(", ")})`);
      console.log(`인덱스 생성: ${idx.table}.${idx.name}`);
    } catch (e) {
      // 인덱스 하나가 실패해도 서버 기동은 막지 않는다.
      console.error(`인덱스 생성 실패 ${idx.table}.${idx.name}:`, e.message);
      skipped.push(`${idx.table}.${idx.name} (실패: ${e.message})`);
    }
  }

  if (verbose) {
    console.log(`\n생성됨 ${created.length}건`);
    created.forEach((c) => console.log(`  + ${c}`));
    console.log(`건너뜀 ${skipped.length}건`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
  return { created, skipped };
}

module.exports = { ensureIndexes, INDEXES };

// 단독 실행: node db/ensure-indexes.js
if (require.main === module) {
  require("dotenv").config();
  ensureIndexes({ verbose: true })
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
