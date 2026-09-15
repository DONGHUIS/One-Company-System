// 스마트택배 로그인 문의 자동 초안 — 원할 때만 수동으로 1회 실행
//   cd server && node scripts/run-sweettracker-draft.js
// 검색 조건을 바꿔 실행하려면:
//   node scripts/run-sweettracker-draft.js 'label:스마트택배-문의처리 newer_than:7d'
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { runSweettrackerDraft } = require("../lib/sweettrackerDraft");

runSweettrackerDraft(process.argv[2])
  .then(({ summary, results }) => {
    for (const r of results) {
      if (r.status === "drafted") console.log(`  초안 [${r.rule}] → ${r.to}`);
      else console.log(`  ${r.status} msg=${r.msgId}`);
    }
    console.log(summary);
    process.exit(0);
  })
  .catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
