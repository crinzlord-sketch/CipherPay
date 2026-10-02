import { Router, type IRouter } from "express";
import path from "node:path";
import fs from "node:fs";
import { kliphubGeneratedPath, runKlipHubGenerationJob } from "../lib/kliphub-local-engine";
import { and, desc, eq, count } from "drizzle-orm";
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

// Generated media is served from the local engine output directory. This is intentionally
// public for the first CPU prototype so browser previews work without signed URLs.
router.get("/kliphub/generated/*splat", (req, res): void => {
  const splat = Array.isArray((req.params as any).splat) ? (req.params as any).splat : [String((req.params as any).splat ?? "")];
  const filePath = kliphubGeneratedPath(splat);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.status(404).end(); return; }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(path.resolve(filePath));
});


function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}

function planScenes(durationSec: number, prompt: string) {
  const templates = [
    ["Opening hook", "Wide cinematic establishing shot. "],
    ["Story beat", "Medium shot with clear subject action. "],
    ["Dynamic moment", "Energetic moving camera close-up. "],
    ["Detail insert", "Macro detail shot with premium lighting. "],
    ["Hero reveal", "Hero reveal with polished cinematic composition. "],
    ["Closing frame", "Clean memorable closing shot with room for a call to action. "],
  ];
  const count = durationSec <= 30 ? 4 : durationSec <= 60 ? 5 : 6;
  const base = Math.max(3, Math.floor(durationSec / count));
  return templates.slice(0, count).map(([title, lead], index) => ({
    position: index,
    title,
    prompt: lead + prompt,
    durationSec: index === count - 1 ? Math.max(3, durationSec - base * (count - 1)) : base,
  }));
}

router.get("/kliphub/overview", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const projects = await db.select().from(kliphubProjectsTable)
    .where(eq(kliphubProjectsTable.userId, userId))
    .orderBy(desc(kliphubProjectsTable.updatedAt)).limit(50);
  const jobs = await db.select().from(kliphubJobsTable)
    .where(eq(kliphubJobsTable.userId, userId))
    .orderBy(desc(kliphubJobsTable.createdAt)).limit(20);
  const channels = await db.select().from(kliphubChannelsTable).where(eq(kliphubChannelsTable.userId, userId));
  const schedules = await db.select().from(kliphubSchedulesTable)
    .where(and(eq(kliphubSchedulesTable.userId, userId), eq(kliphubSchedulesTable.status, "scheduled")));
  const assets = await db.select().from(kliphubAssetsTable).where(eq(kliphubAssetsTable.userId, userId)).limit(50);
  const [credit] = await db.select({ balance: kliphubCreditsTable.balanceAfter })
    .from(kliphubCreditsTable).where(eq(kliphubCreditsTable.userId, userId))
    .orderBy(desc(kliphubCreditsTable.createdAt)).limit(1);

  res.json({
    credits: credit?.balance ?? 3000,
    projects,
    jobs,
    channels,
    schedules,
    assets,
    stats: {
      projects: projects.length,
      generations: jobs.length,
      channels: channels.length,
      scheduled: schedules.length,
      assets: assets.length,
    },
  });
});

router.post("/kliphub/projects", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  const prompt = String(req.body?.prompt ?? "").trim().slice(0, 4000);
  const durationSec = Math.min(120, Math.max(10, Number(req.body?.durationSec ?? 30)));
  if (!title || !prompt || !Number.isFinite(durationSec)) {
    res.status(400).json({ error: "Title, prompt and duration are required." }); return;
  }

  const [project] = await db.insert(kliphubProjectsTable).values({
    userId, title, prompt, durationSec, status: "generating",
  }).returning();
  const scenes = planScenes(durationSec, prompt);
  await db.insert(kliphubScenesTable).values(scenes.map(scene => ({ ...scene, projectId: project.id })));
  await db.update(kliphubProjectsTable).set({ status: "ready", updatedAt: new Date() })
    .where(eq(kliphubProjectsTable.id, project.id));
  res.status(201).json({ projectId: project.id });
});

router.get("/kliphub/projects/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const id = Number(req.params.id);
  if (!userId || !Number.isFinite(id)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [project] = await db.select().from(kliphubProjectsTable)
    .where(and(eq(kliphubProjectsTable.id, id), eq(kliphubProjectsTable.userId, userId))).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const scenes = await db.select().from(kliphubScenesTable).where(eq(kliphubScenesTable.projectId, id)).orderBy(kliphubScenesTable.position);
  const jobs = await db.select().from(kliphubJobsTable).where(eq(kliphubJobsTable.projectId, id)).orderBy(desc(kliphubJobsTable.createdAt));
  res.json({ project, scenes, jobs });
});

router.post("/kliphub/projects/:id/jobs", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const projectId = Number(req.params.id);
  if (!userId || !Number.isFinite(projectId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [project] = await db.select({ id: kliphubProjectsTable.id }).from(kliphubProjectsTable)
    .where(and(eq(kliphubProjectsTable.id, projectId), eq(kliphubProjectsTable.userId, userId))).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const sceneId = req.body?.sceneId ? Number(req.body.sceneId) : null;
  if (sceneId) {
    const [scene] = await db.select({ id: kliphubScenesTable.id }).from(kliphubScenesTable)
      .where(and(eq(kliphubScenesTable.id, sceneId), eq(kliphubScenesTable.projectId, projectId))).limit(1);
    if (!scene) { res.status(400).json({ error: "Scene does not belong to this project." }); return; }
  }
  const type = String(req.body?.type ?? "scene_video").slice(0, 40);
  const [job] = await db.insert(kliphubJobsTable).values({
    userId, projectId, sceneId, type, provider: "kliphub-local-cpu", status: "queued", progress: 0,
    inputJson: JSON.stringify(req.body ?? {}),
  }).returning();
  void runKlipHubGenerationJob(job.id);\n  res.status(201).json({ jobId: job.id, status: "processing" });
});

router.get("/kliphub/projects/:id/jobs", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const projectId = Number(req.params.id);
  if (!userId || !Number.isFinite(projectId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const jobs = await db.select().from(kliphubJobsTable)
    .where(and(eq(kliphubJobsTable.projectId, projectId), eq(kliphubJobsTable.userId, userId)))
    .orderBy(desc(kliphubJobsTable.createdAt)).limit(50);
  res.json({ jobs });
});

export default router;
