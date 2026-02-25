import express from "express";

export function startHealthServer(port = 3000): void {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.listen(port, () => {
    console.log(`[sweny] Health check listening on :${port}/health`);
  });
}
