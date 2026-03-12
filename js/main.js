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
    document.getElementById("gmailCard").style.display = "none";
    document.getElementById("driveCard").style.display = "none";
    document.getElementById("tasksCard").style.display = "none";
    document.getElementById("changePwBtn").style.display = "inline-block";
  }
});
