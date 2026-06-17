module.exports = {
  apps: [{
    name: 'eat-what-tmr',
    script: 'server/index.js',
    cwd: __dirname,
    autorestart: true,
  }]
};
