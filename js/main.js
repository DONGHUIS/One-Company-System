// ── 페이지 로드 시 자동 초기화 ──
checkAuth().then((ok) => {
  if (!ok) return;
  fetchUserInfo();
  initDriveCard();
  fetchCalendarEvents(calYear, calMonth);
  fetchEmails();
  initDashboard();
  fetchDashboardUnread();
  initTasksCard();
  initMapsCard();
});
