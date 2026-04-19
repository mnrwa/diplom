/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", ".next");

try {
  fs.rmSync(target, { recursive: true, force: true });
} catch (error) {
  console.error(`[clean-next] Failed to remove ${target}: ${String(error)}`);
}

if (fs.existsSync(target)) {
  console.error(
    `[clean-next] ${target} is still present. Stop old Next.js dev servers and retry.`,
  );
  process.exit(1);
}
