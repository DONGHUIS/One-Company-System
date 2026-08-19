const cron = require("node-cron");
const db = require("./db");
const { runBackup } = require("./db/backup");

// ── DB 백업 Cron (매일 새벽 3시 30분) ──
// 보관 기간은 BACKUP_RETENTION_DAYS(기본 7일), 저장 위치는 BACKUP_DIR 로 조절한다.
const backupTask = cron.schedule("30 3 * * *", async () => {
  try {
    await runBackup();
  } catch (e) {
    console.error("DB 백업 실패:", e.message);
  }
});

// ── 소프트 딜리트 메모 영구 삭제 Cron (매일 자정) ──
const memoCleanupTask = cron.schedule("0 0 * * *", async () => {
  try {
    const [result] = await db.query(
      `DELETE FROM memos WHERE deleted_at IS NOT NULL AND deleted_at <= NOW() - INTERVAL 15 DAY`
    );
    if (result.affectedRows > 0) {
      console.log(`만료 메모 영구 삭제: ${result.affectedRows}건`);
    }
  } catch (e) {
    console.error("메모 삭제 cron 오류:", e.message);
  }
});

// ── 예약 메일 발송 Cron (매분 실행) ──
const scheduledMailTask = cron.schedule("* * * * *", async () => {
  try {
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
    if (!rows.length) return;

    for (const row of rows) {
      try {
        const [sessions] = await db.query(
          `SELECT data FROM sessions WHERE data LIKE ? ORDER BY expires DESC LIMIT 1`,
          [`%"id":${row.uid}%`]
        );
        if (!sessions.length) {
          await db.query(
            `UPDATE scheduled_emails SET status='failed', error_msg='세션 없음', sent_at=NOW() WHERE id=?`,
            [row.id]
          );
          continue;
        }

        const sessionData = JSON.parse(sessions[0].data);
        const accessToken = sessionData?.passport?.user?.accessToken;
        if (!accessToken) {
          await db.query(
            `UPDATE scheduled_emails SET status='failed', error_msg='액세스 토큰 없음', sent_at=NOW() WHERE id=?`,
            [row.id]
          );
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
          console.log(`예약 메일 발송 완료: id=${row.id} to=${row.to_addr}`);
        } else {
          const err = await gmailRes.json();
          await db.query(
            `UPDATE scheduled_emails SET status='failed', error_msg=?, sent_at=NOW() WHERE id=?`,
            [err.error?.message || "Gmail API 오류", row.id]
          );
        }
      } catch (e) {
        await db.query(
          `UPDATE scheduled_emails SET status='failed', error_msg=?, sent_at=NOW() WHERE id=?`,
          [e.message, row.id]
        );
      }
    }
  } catch (e) {
    console.error("예약 메일 cron 오류:", e.message);
  }
});

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
