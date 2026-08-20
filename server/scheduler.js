const cron = require("node-cron");
const db = require("./db");
const { runBackup } = require("./db/backup");
const batchLog = require("./lib/batchLog");

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

// ── 예약 메일 발송 Cron (매분 실행) ──
// quiet: 발송할 메일이 없었던 실행은 기록하지 않는다 (매분 로그 방지)
const scheduledMailTask = cron.schedule(
  "* * * * *",
  batchLog.wrapJob(
    "예약메일",
    async () => {
      // 1) pending → sending 으로 원자적 선점 (중복 발송 방지)
      await db.query(
        `UPDATE scheduled_emails SET status='sending'
       WHERE status='pending' AND scheduled_at <= NOW()`
      );

      // 2) 방금 선점한 행만 조회
      const [rows] = await db.query(
        `SELECT se.*, u.id AS uid
       FROM scheduled_emails se
       JOIN users u ON se.user_id = u.id
       WHERE se.status = 'sending'`
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

      for (const row of rows) {
        try {
          const [sessions] = await db.query(
            `SELECT data FROM sessions WHERE data LIKE ? ORDER BY expires DESC LIMIT 1`,
            [`%"id":${row.uid}%`]
          );
          if (!sessions.length) {
            await fail(row, "세션 없음");
            continue;
          }

          const sessionData = JSON.parse(sessions[0].data);
          const accessToken = sessionData?.passport?.user?.accessToken;
          if (!accessToken) {
            await fail(row, "액세스 토큰 없음");
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
  "등록 완료 — DB백업(매일 03:30), 메모정리(매일 00:00), 예약메일(매분)"
);

// 종료 시 스케줄러를 멈추기 위해 태스크를 노출한다.
async function stopAll() {
  await Promise.allSettled([
    memoCleanupTask.stop(),
    scheduledMailTask.stop(),
    backupTask.stop(),
  ]);
}

module.exports = {
  memoCleanupTask,
  scheduledMailTask,
  backupTask,
  stopAll,
};
