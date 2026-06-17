module.exports = {
  apps: [{
    name: 'eat-what-tmr',
    script: 'server/index.js',
    cwd: __dirname,
    // 收到 webhook 後 process.exit(0)，pm2 自動重啟
    autorestart: true,
    // 檔案變更也自動重啟（備用機制）
    watch: ['output'],
    watch_delay: 3000,
  }]
};
