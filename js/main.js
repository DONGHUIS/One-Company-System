// ── 페이지 로드 시 자동 초기화 ──
checkAuth().then((user) => {
  if (!user) return;
  fetchUserInfo();
  fetchCalendarEvents(calYear, calMonth);
  initDashboard();
  initMapsCard();
  initReminders();

  if (user.hasGoogle) {
    initDriveCard();
    fetchEmails();
    fetchDashboardUnread();
    initTasksCard();
  } else {
    //구글 로그인 사용자만  지메일,구글드라이브,구글태스트,Ai채팅기능 활성화
    document.getElementById("gmailCard").style.display = "none";
    document.getElementById("driveCard").style.display = "none";
    document.getElementById("tasksCard").style.display = "none";
//구글로그인사용자는 비밀번호 변경 버튼 비활성화
    document.getElementById("changePwBtn").style.display = "inline-block";
    fetchDashboardMemoCount();
  }
});
