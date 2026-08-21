const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { runBackup } = require("./db/backup");
const batchLog = require("./lib/batchLog");
const { getFreshAccessToken } = require("./lib/googleTokens");

// ── DB 백업 Cron (매일 새벽 3시 30분) ──
// 보관 기간은 BACKUP_RETENTION_DAYS(기본 7일), 저장 위치는 BACKUP_DIR 로 조절한다.
const backupTask = cron.schedule(
  "30 3 * * *",
  batchLog.wrapJob("DB백업", async () => {
    const { summary } = await runBackup();
    return summary;
  })
);

// ── 소프트 딜리트 메모 영구 삭제 Cron (매일 자정) ──
const memoCleanupTask = cron.schedule(
  "0 0 * * *",
  batchLog.wrapJob("메모정리", async () => {
    const [result] = await db.query(
      `DELETE FROM memos WHERE deleted_at IS NOT NULL AND deleted_at <= NOW() - INTERVAL 15 DAY`
    );
    return result.affectedRows > 0
      ? `만료 메모 영구 삭제 ${result.affectedRows}건`
      : "삭제할 메모 없음";
  })
);

// ── 고아 업로드 파일 정리 Cron (매일 04:00) ──
// 메시지를 삭제해도 첨부 파일은 uploads/ 에 남는다.
// messages.file_url 에서 더 이상 참조되지 않는 파일을 지운다.
const UPLOADS_DIR = path.join(__dirname, "uploads");
// 업로드 엔드포인트가 만드는 파일명 형식만 건드린다 (.gitkeep 등 오삭제 방지)
const UPLOAD_FILE_RE = /^\d+_[a-z0-9]+\.[A-Za-z0-9]+$/;

const uploadCleanupTask = cron.schedule(
  "0 4 * * *",
  batchLog.wrapJob("업로드정리", async () => {
    let names = [];
    try {
      names = fs.readdirSync(UPLOADS_DIR);
    } catch {
      return "uploads 디렉터리 없음";
    }
    // 업로드 직후 메시지 저장 전인 파일을 지우지 않도록 24시간 유예를 둔다.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const candidates = names.filter((n) => {
      if (!UPLOAD_FILE_RE.test(n)) return false;
      try {
        return fs.statSync(path.join(UPLOADS_DIR, n)).mtimeMs < cutoff;
      } catch {
        return false;
      }
    });
    if (!candidates.length) return "삭제할 파일 없음";

    let removed = 0;
    let bytes = 0;
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const [rows] = await db.query(
        `SELECT file_url FROM messages WHERE file_url IN (?)`,
        [chunk.map((n) => `/uploads/${n}`)]
      );
      const referenced = new Set(rows.map((r) => r.file_url));
      for (const n of chunk) {
        if (referenced.has(`/uploads/${n}`)) continue;
        const full = path.join(UPLOADS_DIR, n);
        try {
          bytes += fs.statSync(full).size;
          fs.unlinkSync(full);
          removed++;
        } catch (e) {
          batchLog.log("업로드정리", `삭제 실패 ${n}: ${e.message}`);
        }
      }
    }
    return removed
      ? `고아 파일 ${removed}건 삭제 (${(bytes / 1024 / 1024).toFixed(1)} MB)`
      : "삭제할 파일 없음";
  })
);

// ── 예약 메일 발송 Cron (매분 실행) ──
// quiet: 발송할 메일이 없었던 실행은 기록하지 않는다 (매분 로그 방지)
const scheduledMailTask = cron.schedule(
  "* * * * *",
  batchLog.wrapJob(
    "예약메일",
    async () => {
      // 0) 이전 실행이 크래시로 남긴 'sending' 잔류 행 정리.
      //    재발송하면 크래시 시점에 따라 중복 발송될 수 있으므로,
      //    실패로 표시해 사용자가 목록에서 보고 다시 예약하게 한다.
      await db.query(
        `UPDATE scheduled_emails
       SET status='failed', error_msg='발송 중단됨 (서버 재시작) — 다시 예약해 주세요', sent_at=NOW()
       WHERE status='sending'
         AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL 10 MINUTE)`
      );

      // 1) pending → sending 으로 원자적 선점.
      //    이번 틱 고유의 batch_id 를 찍어, 발송이 1분을 넘겨 다음 틱과
      //    겹쳐도 각 틱이 자기 몫만 발송한다 (중복 발송 방지).
      const batchId = require("crypto").randomUUID();
      await db.query(
        `UPDATE scheduled_emails SET status='sending', batch_id=?, claimed_at=NOW()
       WHERE status='pending' AND scheduled_at <= NOW()`,
        [batchId]
      );

      // 2) 이번 틱이 선점한 행만 조회
      const [rows] = await db.query(
        `SELECT se.*, u.id AS uid
       FROM scheduled_emails se
       JOIN users u ON se.user_id = u.id
       WHERE se.status = 'sending' AND se.batch_id = ?`,
        [batchId]
      );
      if (!rows.length) return null;

      let sent = 0;
      let failed = 0;
      const fail = async (row, msg) => {
        await db.query(
          `UPDATE scheduled_emails SET status='failed', error_msg=?, sent_at=NOW() WHERE id=?`,
          [msg, row.id]
        );
        batchLog.log("예약메일", `발송 실패 id=${row.id} to=${row.to_addr}: ${msg}`);
        failed++;
      };

      // 사용자별 토큰은 이번 실행 안에서만 재사용한다 (매 행마다 갱신 방지)
      const tokenCache = new Map();
      const getToken = async (uid) => {
        if (tokenCache.has(uid)) return tokenCache.get(uid);
        let token = null;
        // 1) 저장된 리프레시 토큰으로 갱신 — 로그인 여부와 무관하게 발송 가능
        try {
          const fresh = await getFreshAccessToken(uid);
          if (fresh) token = fresh.accessToken;
        } catch (e) {
          batchLog.log("예약메일", `토큰 갱신 실패 uid=${uid}: ${e.message}`);
        }
        // 2) 폴백: 리프레시 토큰이 아직 없는(재로그인 전) 사용자는 세션에서 찾는다.
        //    세션의 액세스 토큰은 로그인 후 1시간이 지나면 만료돼 실패할 수 있다.
        if (!token) {
          const [sessions] = await db.query(
            `SELECT data FROM sessions WHERE data LIKE ? ORDER BY expires DESC LIMIT 1`,
            [`%"id":${uid}%`]
          );
          if (sessions.length) {
            try {
              token = JSON.parse(sessions[0].data)?.passport?.user?.accessToken || null;
            } catch {}
          }
        }
        tokenCache.set(uid, token);
        return token;
      };

      for (const row of rows) {
        try {
          const accessToken = await getToken(row.uid);
          if (!accessToken) {
            await fail(row, "액세스 토큰 없음 (Google 재로그인 필요)");
            continue;
          }

          const payload = { raw: row.raw_mime };
          if (row.thread_id) payload.threadId = row.thread_id;

          const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (gmailRes.ok) {
            await db.query(
              `UPDATE scheduled_emails SET status='sent', sent_at=NOW() WHERE id=?`,
              [row.id]
            );
            batchLog.log("예약메일", `발송 완료 id=${row.id} to=${row.to_addr}`);
            sent++;
          } else {
            const err = await gmailRes.json();
            await fail(row, err.error?.message || "Gmail API 오류");
          }
        } catch (e) {
          await fail(row, e.message);
        }
      }
      return `발송 ${sent}건` + (failed ? `, 실패 ${failed}건` : "");
    },
    { quiet: true }
  )
);

// 서버 기동 시점을 배치 로그에 남긴다.
// "백업이 안 돌았다 = 그 시각에 서버가 죽어 있었다"를 이 파일만으로 판별할 수 있다.
batchLog.log(
  "스케줄러",
  "등록 완료 — DB백업(매일 03:30), 메모정리(매일 00:00), 업로드정리(매일 04:00), 예약메일(매분)"
);

// 종료 시 스케줄러를 멈추기 위해 태스크를 노출한다.
async function stopAll() {
  await Promise.allSettled([
    memoCleanupTask.stop(),
    scheduledMailTask.stop(),
    uploadCleanupTask.stop(),
    backupTask.stop(),
  ]);
}

module.exports = {
  memoCleanupTask,
  scheduledMailTask,
  uploadCleanupTask,
  backupTask,
  stopAll,
};
