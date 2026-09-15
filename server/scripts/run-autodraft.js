// Jira 로그인 문의 자동 초안을 수동으로 1회 실행 (테스트용)
//   cd server && node scripts/run-autodraft.js
// 검색 조건을 바꿔 실행하려면:
//   node scripts/run-autodraft.js '"로그인 문의" newer_than:7d'
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { runAutoDraft } = require("../lib/autoDraft");

runAutoDraft(process.argv[2])
  .then((summary) => {
    console.log(summary || "처리할 새 메일 없음");
    process.exit(0);
  })
  .catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
