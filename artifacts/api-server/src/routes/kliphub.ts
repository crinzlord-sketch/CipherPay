import { Router, type IRouter } from "express";
import path from "node:path";
import fs from "node:fs";

import { and, desc, eq, count, inArray } from "drizzle-orm";
import {
  db,
  kliphubAssetsTable,
  kliphubChannelsTable,
  kliphubCreditsTable,
  kliphubJobsTable,
  kliphubProjectsTable,
  kliphubSchedulesTable,
  kliphubScenesTable,
} from "@workspace/db";

const router: IRouter = Router();

const MEDIA_ROOT = path.resolve(process.cwd(), "generated", "kliphub");
const MEDIA_PREFIX = "/api/kliphub/generated";

router.get("/kliphub/generated/*splat", (req, res): void => {
  const splat = Array.isArray((req.params as any).splat) ? (req.params as any).splat : [String((req.params as any).splat ?? "")];
  const target = path.resolve(MEDIA_ROOT, ...splat);
  if (!target.startsWith(MEDIA_ROOT + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.status(404).end(); return; }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(target);
});
