// ── Jira 로그인 문의 자동 초안 설정 ──
//
// 답변 내용을 바꾸고 싶으면 이 파일의 draftSubject / draftBody 만 수정하면 된다.
// 수정 후 서버 재시작(pm2 reload) 필요.

module.exports = {
  // 초안을 만들 메일함의 소유자 이메일 (이 앱에 Google 로그인한 계정).
  // 비워두면(null): Google 리프레시 토큰이 저장된 사용자가 1명일 때 그 사용자를 자동 선택.
  // 여러 명이면 환경변수 AUTODRAFT_OWNER_EMAIL 로 지정해야 한다.
  ownerEmail: process.env.AUTODRAFT_OWNER_EMAIL || null,

  // Gmail 검색 조건 — 제목에 [Jira], 내용에 "로그인 문의"가 있는 최근 2일 메일.
  // (이슈 키 P13-677 등은 계속 바뀌므로 조건에 넣지 않는다)
  gmailQuery: 'in:inbox subject:Jira "로그인 문의" newer_than:2d',

  // 본문/제목에 이 문구가 있어야 처리 대상으로 본다 (Gmail 검색 결과 2차 확인)
  mustInclude: "로그인 문의",

  // 한 번 실행에 처리할 최대 메일 수 (폭주 방지)
  maxPerRun: 10,

  // ── 초안(임시보관함) 내용 ── ※ 여기를 원하는 답변으로 수정하세요
  draftSubject: "[스마트택배] 마켓컬리 로그인 문의 답변",
  draftBody: `안녕하세요, 스마트택배 고객지원입니다.

마켓컬리 로그인 관련 문의 주셔서 감사합니다.

(여기에 지정 답변 내용을 작성하세요.
 예: 로그인 오류 해결 절차, 비밀번호 재설정 안내 등)

감사합니다.
스마트택배 드림`,
};
