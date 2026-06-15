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
  data       MEDIUMTEXT
);
