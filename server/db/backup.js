const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

// MySQL 논리 백업 (mysqldump → gzip).
//
// 비밀번호는 MYSQL_PWD 환경변수로 자식 프로세스에만 넘긴다.
// --password= 로 넘기면 작업 관리자·프로세스 목록에 그대로 노출된다.

const DEFAULT_DIR = path.join(__dirname, "..", "..", "backups");
const FILE_RE = /^(.+)_(\d{4}-\d{2}-\d{2}_\d{4})\.sql\.gz$/;

/** mysqldump 실행 파일을 찾는다. PATH 에 없는 Windows 설치를 고려한다. */
function resolveMysqldump() {
  if (process.env.MYSQLDUMP_PATH) {
    if (!fs.existsSync(process.env.MYSQLDUMP_PATH)) {
      throw new Error(
        `MYSQLDUMP_PATH 가 가리키는 파일이 없습니다: ${process.env.MYSQLDUMP_PATH}`,
      );
    }
    return process.env.MYSQLDUMP_PATH;
  }

  const candidates = [];
  for (const base of [
    "C:\\Program Files\\MySQL",
    "C:\\Program Files (x86)\\MySQL",
  ]) {
    let entries = [];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue; // 디렉터리 없음
    }
    for (const dir of entries) {
      candidates.push(path.join(base, dir, "bin", "mysqldump.exe"));
    }
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;

  // 마지막 수단: PATH 에 있다고 가정한다 (Linux/macOS 및 PATH 등록된 Windows).
  return "mysqldump";
}

/** 로컬 시각 기준 YYYY-MM-DD_HHmm */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** 보관 기간이 지난 백업 파일을 지운다. */
function pruneOldBackups(dir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of files) {
    // 백업 파일 형식에 맞는 것만 건드린다 (다른 파일 오삭제 방지).
    if (!FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed.push(name);
      }
    } catch (e) {
      console.error(`백업 정리 실패 ${name}:`, e.message);
    }
  }
  return removed;
}

async function runBackup({ verbose = false } = {}) {
  const database = process.env.DB_NAME;
  if (!database) throw new Error("DB_NAME 환경변수가 없습니다");

  const dir = process.env.BACKUP_DIR || DEFAULT_DIR;
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 7);
  fs.mkdirSync(dir, { recursive: true });

  const outFile = path.join(dir, `${database}_${stamp()}.sql.gz`);
  const bin = resolveMysqldump();

  const args = [
    `--host=${process.env.DB_HOST || "localhost"}`,
    `--port=${process.env.DB_PORT || 3306}`,
    `--user=${process.env.DB_USER}`,
    "--single-transaction", // InnoDB 일관성 스냅샷 (테이블 잠금 없음)
    "--routines",
    "--triggers",
    "--no-tablespaces", // PROCESS 권한 없이도 동작하게
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--databases",
    database,
  ];

  const child = spawn(bin, args, {
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" },
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });

  try {
    await pipeline(
      child.stdout,
      zlib.createGzip({ level: 9 }),
      fs.createWriteStream(outFile),
    );
    const code = await exited;
    if (code !== 0) {
      throw new Error(`mysqldump 종료 코드 ${code}: ${stderr.trim()}`);
    }
  } catch (e) {
    // 실패 시 반쪽짜리 파일을 남기지 않는다 (복구 시 오인 방지).
    try {
      fs.unlinkSync(outFile);
    } catch {}
    if (e.message.includes("ENOENT")) {
      throw new Error(
        `mysqldump 를 찾을 수 없습니다 (${bin}). ` +
          `.env 에 MYSQLDUMP_PATH 를 지정하세요.`,
      );
    }
    throw e;
  }

  const bytes = fs.statSync(outFile).size;
  // gzip 헤더만 있는 빈 덤프(약 20바이트)를 성공으로 착각하지 않도록 검사한다.
  if (bytes < 200) {
    fs.unlinkSync(outFile);
    throw new Error(`백업 파일이 비정상적으로 작습니다 (${bytes} bytes)`);
  }

  const removed = pruneOldBackups(dir, retentionDays);

  // 오프사이트 미러: BACKUP_MIRROR_DIR (NAS·동기화 폴더 등) 로 사본을 복사한다.
  // 백업이 같은 디스크에만 있으면 디스크 장애 시 DB 와 백업이 함께 사라진다.
  // 미러 실패는 본 백업의 성공을 깨지 않고 요약에 경고로만 남긴다.
  let mirrorNote = "";
  const mirrorDir = process.env.BACKUP_MIRROR_DIR;
  if (mirrorDir) {
    try {
      fs.mkdirSync(mirrorDir, { recursive: true });
      fs.copyFileSync(outFile, path.join(mirrorDir, path.basename(outFile)));
      pruneOldBackups(mirrorDir, retentionDays);
      mirrorNote = " / 미러 복사 완료";
    } catch (e) {
      console.error("백업 미러 복사 실패:", e.message);
      mirrorNote = ` / 미러 복사 실패: ${e.message}`;
    }
  }

  const kb = (bytes / 1024).toFixed(1);
  // 완료 로그는 호출자(스케줄러의 batchLog / 아래 CLI)가 남긴다.
  const summary =
    `${path.basename(outFile)} (${kb} KB)` +
    (removed.length ? ` / 만료 백업 ${removed.length}건 삭제` : "") +
    mirrorNote;
  if (verbose) {
    console.log(`DB 백업 완료: ${summary}`);
    console.log(`  경로: ${outFile}`);
    console.log(`  보관: ${retentionDays}일`);
    if (stderr.trim()) console.log(`  mysqldump 경고: ${stderr.trim()}`);
    removed.forEach((r) => console.log(`  삭제됨: ${r}`));
  }
  return { file: outFile, bytes, removed, summary };
}

module.exports = { runBackup, pruneOldBackups, resolveMysqldump };

// 단독 실행: node db/backup.js  (또는 npm run db:backup)
if (require.main === module) {
  require("dotenv").config();
  runBackup({ verbose: true })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("백업 실패:", e.message);
      process.exit(1);
    });
}
