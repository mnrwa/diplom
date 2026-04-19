/* eslint-disable no-console */
const net = require("net");

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0) {
  process.exit(0);
}

const server = net.createServer();

server.once("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(
      `[check-dev-port] Port ${port} is already in use. Stop the old frontend dev server on http://localhost:${port} and retry.`,
    );
    process.exit(1);
  }

  console.error(`[check-dev-port] Failed to validate port ${port}: ${String(error)}`);
  process.exit(1);
});

server.once("listening", () => {
  server.close(() => process.exit(0));
});

server.listen(port, "0.0.0.0");
