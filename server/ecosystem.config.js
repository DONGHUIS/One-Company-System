// PM2 프로세스 정의.
//
// 주의: instances 는 1, exec_mode 는 fork 로 고정한다.
// 현재 서버는 접속자 목록(onlineUsers)을 프로세스 메모리에 들고 있고
// Socket.io 에 Redis 어댑터가 없어서, 프로세스를 늘리면
// 접속자 표시와 메시지 브로드캐스트가 인스턴스별로 갈라진다.
// 멀티코어 활용은 Redis 어댑터 도입 이후에 검토할 것.
module.exports = {
  apps: [
    {
      name: "memo-server",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",

      // 재시작 정책
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s", // 30초 안에 죽으면 크래시로 집계
      restart_delay: 3000,
      max_memory_restart: "600M",

      // 종료 정책: shutdown 신호 후 정리에 최대 12초를 준다
      // (server.js 의 강제 종료 타이머 10초보다 여유 있게)
      kill_timeout: 12000,
      shutdown_with_message: true, // Windows: SIGINT 대신 IPC 메시지로 종료 통보
      wait_ready: false,

      // 로그
      out_file: "../logs/server-out.log",
      error_file: "../logs/server-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },

    // ── ngrok 터널 ──
    // 외부 접속용 고정 도메인 터널. 서버(4000)와 함께 상시 떠 있어야 하며,
    // pm2 save 에 포함되어 로그온 시 pm2-resurrect 로 같이 복구된다.
    // 도메인은 .env(FRONTEND_URL·GOOGLE_CALLBACK_URL)와 반드시 일치해야 한다.
    {
      name: "ngrok-tunnel",
      script:
        "C:\\Users\\happytalk\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\\ngrok.exe",
      args:
        "http --domain=euphonic-henriette-unousted.ngrok-free.dev 4000 --log stdout",
      interpreter: "none", // node 스크립트가 아닌 실행 파일
      instances: 1,
      exec_mode: "fork",

      // 부팅 직후 네트워크가 아직 없으면 ngrok 이 바로 종료된다.
      // 지수 백오프로 재시도해 재시작 횟수 소진을 막는다.
      autorestart: true,
      exp_backoff_restart_delay: 5000,
      max_restarts: 50,
      min_uptime: "30s",

      out_file: "../logs/ngrok-out.log",
      error_file: "../logs/ngrok-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
