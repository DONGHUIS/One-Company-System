const fs = require("fs");
const path = require("path");

// ── 배치(cron) 전용 로그 ──
//
// 서버를 pm2 없이 수동으로 띄우면 console 출력이 어디에도 남지 않아
// "백업 cron 이 언제부터 안 돌았는지"조차 알 수 없다.
// 배치 실행 기록만큼은 실행 방식과 무관하게 항상 파일로 남긴다.
// (콘솔에도 같이 찍으므로 pm2 로그에서도 보인다)
//
// 확인: npm run logs:batch  (실시간 tail)

const LOG_DIR = process.env.BATCH_LOG_DIR || path.join(__dirname, "..", "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "batch.log");

// pm2-logrotate 는 pm2 가 관리하는 로그만 회전시키므로 이 파일은 직접 관리한다.
// 5MB 를 넘으면 batch.log.1 로 밀어내고 새로 쓴다 (1세대만 보관).
const MAX_BYTES = 5 * 1024 * 1024;

function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size < MAX_BYTES) return;
    fs.rmSync(`${LOG_FILE}.1`, { force: true });
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // 파일 없음 등 — 회전할 것도 없다
  }
}

function write(level, job, msg) {
  const line = `${ts()} [${job}]${level === "error" ? " ERROR" : ""} ${msg}`;
  (level === "error" ? console.error : console.log)(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (e) {
    console.error("배치 로그 기록 실패:", e.message);
  }
}

const log = (job, msg) => write("info", job, msg);
const error = (job, msg) => write("error", job, msg);

// cron 콜백 래퍼. 시작/완료/실패와 소요 시간을 기록한다.
//
// fn 은 결과 요약 문자열을 반환한다 (없으면 null).
// quiet: 매분 도는 작업용 — 할 일이 없었던 실행(fn 이 null 반환)은
//        기록하지 않는다. 실패는 quiet 여도 항상 기록한다.
function wrapJob(name, fn, { quiet = false } = {}) {
  return async () => {
    const t0 = Date.now();
    if (!quiet) log(name, "시작");
    try {
      const summary = await fn();
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      if (!quiet || summary != null) {
        log(name, `완료${summary ? `: ${summary}` : ""} (${dur}초)`);
      }
    } catch (e) {
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      error(name, `실패: ${e.message} (${dur}초)`);
    }
  };
}

module.exports = { log, error, wrapJob, LOG_FILE };
