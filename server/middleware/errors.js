// 500 응답 헬퍼.
//
// 라우터마다 res.status(500).json({ error: e.message }) 로 응답하면
// SQL 오류 문구와 테이블 구조가 그대로 클라이언트에 노출된다.
// 상세 내용은 서버 로그에만 남기고 클라이언트에는 일반 문구를 준다.
function serverError(res, e, message = "서버 오류가 발생했습니다") {
  console.error("요청 처리 오류:", e);
  if (res.headersSent) return res;
  return res.status(500).json({ error: message });
}

module.exports = { serverError };
