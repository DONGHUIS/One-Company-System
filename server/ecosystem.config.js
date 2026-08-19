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
  ],
};
