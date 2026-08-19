-- 실행 방법:
-- mysql -u root -p one_company_db < schema.sql

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  google_id  VARCHAR(100) UNIQUE NOT NULL,
  email      VARCHAR(200) UNIQUE NOT NULL,
  name       VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 메모 테이블
CREATE TABLE IF NOT EXISTS memos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      TEXT,
  content    TEXT,
  tag        VARCHAR(50) DEFAULT '일반',
  edited_at  DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  -- 목록/휴지통 조회용 (user_id + 삭제여부 + 정렬)
  KEY idx_user_deleted_created (user_id, deleted_at, created_at),
  -- 자정 영구삭제 cron 용 (deleted_at 단독 조건)
  KEY idx_deleted_at (deleted_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 서명 테이블
CREATE TABLE IF NOT EXISTS signatures (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  name       VARCHAR(100) NOT NULL,
  content    TEXT,
  is_default TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 임시저장 테이블
CREATE TABLE IF NOT EXISTS drafts (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id  INT NOT NULL,
  to_addr  TEXT,
  cc       TEXT,
  subject  TEXT,
  body     TEXT,
  saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 메모 공유 링크 테이블
CREATE TABLE IF NOT EXISTS memo_shares (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  memo_id    INT NOT NULL,
  token      VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
);

-- 사용자 행동 로그 테이블
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT,
  action     VARCHAR(50)  NOT NULL,
  target     VARCHAR(200),
  detail     JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 세션 테이블 (express-mysql-session 자동 생성)
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT,
  -- 15분마다 도는 만료 세션 정리(DELETE ... WHERE expires < ?)용
  KEY idx_expires (expires)
);

-- 누락 인덱스 보정:
--   node db/ensure-indexes.js  (또는 npm run db:indexes)
-- 이미 운영 중인 DB 는 위 KEY 정의가 적용되지 않으므로 위 스크립트로 채운다.
