// إعداد pm2 عشان البوت يشتغل 24 ساعة ويقوم لوحده لو وقع:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'orma-bot',
      script: 'src/index.js',
      max_memory_restart: '250M',
      restart_delay: 5000,
      time: true,
    },
  ],
};
