import "dotenv/config";
import app from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { outboxWorker } from "./services/outbox-worker";

const server = app.listen(env.PORT, () => {
  console.log(`Newtonite Ops API running on port ${env.PORT}`);
  if (env.OUTBOX_WORKER_ENABLED) {
    outboxWorker.start();
    console.log("Transactional outbox worker started");
  }
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    try {
      await outboxWorker.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (shutdownError) {
      console.error("Application shutdown failed", {
        name:
          shutdownError instanceof Error
            ? shutdownError.name
            : "UnknownError",
      });
      process.exitCode = 1;
    } finally {
      try {
        await prisma.$disconnect();
      } catch (disconnectError) {
        console.error("Database shutdown failed", {
          name: disconnectError instanceof Error ? disconnectError.name : "UnknownError",
        });
        process.exitCode = 1;
      }
    }
  })();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);