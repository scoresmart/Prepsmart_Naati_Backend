module.exports = {
  apps: [
    {
      name: "prepsmart-backend",
      script: "src/server.js",
      interpreter: "node",
      interpreter_args: "--experimental-vm-modules",
      instances: "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "500M",
      env_production: {
        NODE_ENV: "production",
        APP_ENV: "production",
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
