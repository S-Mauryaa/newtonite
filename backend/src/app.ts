import express from "express";
import cors from "cors";
import helmet from "helmet";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { itemsRouter } from "./routes/items";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { prisma } from "./lib/prisma";
import { env } from "./config/env";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: env.FRONTEND_URL,
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Newtonite Ops API is running",
  });
});

app.get("/api/ready", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.status(200).json({ status: "ready" });
});

app.use("/api/auth", authRouter);
app.use("/api/items", itemsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use(notFound);
app.use(errorHandler);

export default app;