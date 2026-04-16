/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, "..", ".env"));

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const deletedNews = await prisma.driverNews.deleteMany({
      where: { routeId: { not: null } },
    });
    const deletedGps = await prisma.gpsLog.deleteMany({
      where: { routeId: { not: null } },
    });
    const deletedRoutes = await prisma.route.deleteMany({});

    // After clearing routes, reset vehicle status so UI doesn't show "ON_ROUTE" forever.
    await prisma.vehicle.updateMany({
      data: { status: "IDLE" },
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          deleted: {
            routes: deletedRoutes.count,
            route_news: deletedNews.count,
            route_gps_logs: deletedGps.count,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("clear-route-mocks failed:", error);
  process.exitCode = 1;
});

