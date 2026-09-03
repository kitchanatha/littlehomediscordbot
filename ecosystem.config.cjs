module.exports = {
  apps: [
    {
      name: "ragnarok-guild-bot",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      cwd: __dirname,
      interpreter: "node",
      restart_delay: 5000,
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
