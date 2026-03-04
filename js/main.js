// ── 페이지 로드 시 자동 초기화 ──
if (gmailToken) {
  fetchUserInfo();
  initDriveCard();
  fetchCalendarEvents(calYear, calMonth);
  fetchEmails();
  initDashboard();
  fetchDashboardUnread();
  initTasksCard();
}
