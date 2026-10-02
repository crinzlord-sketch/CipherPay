import { Router, type IRouter } from "express";
import path from "node:path";
import fs from "node:fs";
import { and, desc, eq, count, inArray } from "drizzle-orm";
import { createRunwayImage, createRunwayImageToVideo, getRunwayTask, downloadRunwayOutput } from "../lib/kliphub-providers";
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


function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}

const runwaySyncing = new Set<number>();

async function syncRunwayJob(job: any): Promise<void> {
  if (job.provider !== "runway" || !job.providerJobId || ["succeeded", "failed", "canceled"].includes(String(job.status).toLowerCase())) return;
  if (runwaySyncing.has(job.id)) return;
  runwaySyncing.add(job.id);
  try {
    const task = await getRunwayTask(String(job.providerJobId));
    const status = String(task?.status || "PENDING").toLowerCase();
    if (status === "succeeded" && Array.isArray(task.output) && task.output[0]) {
      const output = await downloadRunwayOutput(
        String(task.output[0]),
        path.join(MEDIA_ROOT, "images"),
        `kliphub-job-${job.id}`,
      );
      const isVideo = output.type === "video";
      const mediaDir = isVideo ? "videos" : "images";
      const publicUrl = output.url.replace("/images/", `/${mediaDir}/`);
      const outputJson = JSON.stringify({ provider: "runway", taskId: job.providerJobId, output: publicUrl, type: output.type });
      await db.update(kliphubJobsTable).set({
        status: "succeeded", progress: 100, outputJson, finishedAt: new Date(),
      }).where(eq(kliphubJobsTable.id, job.id));
      await db.insert(kliphubAssetsTable).values({
        userId: job.userId,
        projectId: job.projectId,
        name: `KlipHub ${output.type} ${job.id}`,
        type: output.type,
        url: publicUrl,
      });
      if (isVideo && job.sceneId) {
        await db.update(kliphubScenesTable).set({ videoUrl: publicUrl, status: "completed" })
          .where(eq(kliphubScenesTable.id, job.sceneId));
      }
    } else if (["failed", "canceled"].includes(status)) {
      const error = task?.failure || task?.error || `Runway task ${status}.`;
      await db.update(kliphubJobsTable).set({
        status, error: String(error).slice(0, 2000), finishedAt: new Date(),
      }).where(eq(kliphubJobsTable.id, job.id));
    } else {
      const progress = Number.isFinite(Number(task?.progress)) ? Math.max(1, Math.min(99, Number(task.progress))) : Math.min(95, Math.max(5, Number(job.progress || 5) + 5));
      await db.update(kliphubJobsTable).set({ status: "processing", progress }).where(eq(kliphubJobsTable.id, job.id));
    }
  } catch (error: any) {
    await db.update(kliphubJobsTable).set({ error: String(error?.message || error).slice(0, 2000) }).where(eq(kliphubJobsTable.id, job.id));
  } finally {
    runwaySyncing.delete(job.id);
  }
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
  const pendingJobs = await db.select().from(kliphubJobsTable)
    .where(and(eq(kliphubJobsTable.userId, userId), eq(kliphubJobsTable.provider, "runway")))
    .orderBy(desc(kliphubJobsTable.createdAt)).limit(20);
  await Promise.all(pendingJobs.map((job) => syncRunwayJob(job)));
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

router.post("/kliphub/assets", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const projectId = Number(req.body?.projectId);
  const dataUrl = String(req.body?.dataUrl ?? "");
  const name = String(req.body?.name ?? "kliphub-generation.png").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  if (!Number.isFinite(projectId) || !dataUrl.startsWith("data:image/")) { res.status(400).json({ error: "A project and generated image are required." }); return; }
  const [project] = await db.select({ id: kliphubProjectsTable.id }).from(kliphubProjectsTable)
    .where(and(eq(kliphubProjectsTable.id, projectId), eq(kliphubProjectsTable.userId, userId))).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found." }); return; }
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) { res.status(400).json({ error: "Only PNG, JPEG or WebP images are supported." }); return; }
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const finalName = name.replace(/\.[^.]+$/, "") + "." + ext;
  const dir = path.join(MEDIA_ROOT, "images");
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = userId + "-" + Date.now() + "-" + finalName;
  await fs.promises.writeFile(path.join(dir, filename), Buffer.from(match[2], "base64"));
  const url = MEDIA_PREFIX + "/images/" + filename;
  const [asset] = await db.insert(kliphubAssetsTable).values({ userId, projectId, name: finalName, type: "image", url }).returning();
  res.status(201).json({ asset });
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
  const [project] = await db.select().from(kliphubProjectsTable)
    .where(and(eq(kliphubProjectsTable.id, projectId), eq(kliphubProjectsTable.userId, userId))).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found." }); return; }

  const sceneId = req.body?.sceneId ? Number(req.body.sceneId) : null;
  if (sceneId) {
    const [scene] = await db.select({ id: kliphubScenesTable.id }).from(kliphubScenesTable)
      .where(and(eq(kliphubScenesTable.id, sceneId), eq(kliphubScenesTable.projectId, projectId))).limit(1);
    if (!scene) { res.status(400).json({ error: "Scene does not belong to this project." }); return; }
  }

  const type = String(req.body?.type ?? "image").slice(0, 40);
  const prompt = String(req.body?.prompt ?? project.prompt ?? project.title).trim().slice(0, 32000);
  const input = { ...req.body, prompt, projectId, sceneId };

  try {
    let task: any;
    if (type === "video") {
      const promptImage = String(req.body?.promptImage ?? "").trim();
      if (!promptImage.startsWith("https://")) {
        res.status(400).json({ error: "Video generation requires an HTTPS source image." }); return;
      }
      task = await createRunwayImageToVideo(
        promptImage,
        prompt,
        Number(req.body?.duration ?? 5),
        String(req.body?.ratio ?? "1280:720"),
      );
    } else {
      task = await createRunwayImage(prompt, String(req.body?.ratio ?? "16:9"));
    }

    const [job] = await db.insert(kliphubJobsTable).values({
      userId, projectId, sceneId, type, provider: "runway", status: "processing", progress: 5,
      inputJson: JSON.stringify(input), outputJson: JSON.stringify({ taskId: task.id }), 
      startedAt: new Date(),
    }).returning();

    res.status(201).json({ jobId: job.id, provider: "runway", providerJobId: task.id, status: job.status });
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 2000);
    const [job] = await db.insert(kliphubJobsTable).values({
      userId, projectId, sceneId, type, provider: "runway", status: "failed", progress: 0,
      inputJson: JSON.stringify(input), error: message, finishedAt: new Date(),
    }).returning();
    res.status(502).json({ error: message, jobId: job.id });
  }
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

router.delete("/kliphub/reset", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const projects = await db.select({ id: kliphubProjectsTable.id }).from(kliphubProjectsTable).where(eq(kliphubProjectsTable.userId, userId));
  const projectIds = projects.map(p => p.id);
  if (projectIds.length) {
    const assets = await db.select({ url: kliphubAssetsTable.url }).from(kliphubAssetsTable)
      .where(and(eq(kliphubAssetsTable.userId, userId), inArray(kliphubAssetsTable.projectId, projectIds)));
    for (const asset of assets) {
      try {
        const raw = String(asset.url || "");
        const prefix = MEDIA_PREFIX + "/";
        if (raw.startsWith(prefix)) {
          const target = path.resolve(MEDIA_ROOT, ...raw.slice(prefix.length).split("/"));
          if (target.startsWith(MEDIA_ROOT + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) await fs.promises.unlink(target);
        }
      } catch {}
    }
    await db.delete(kliphubAssetsTable).where(and(eq(kliphubAssetsTable.userId, userId), inArray(kliphubAssetsTable.projectId, projectIds)));
    await db.delete(kliphubJobsTable).where(and(eq(kliphubJobsTable.userId, userId), inArray(kliphubJobsTable.projectId, projectIds)));
    await db.delete(kliphubScenesTable).where(inArray(kliphubScenesTable.projectId, projectIds));
    await db.delete(kliphubSchedulesTable).where(and(eq(kliphubSchedulesTable.userId, userId), inArray(kliphubSchedulesTable.projectId, projectIds)));
    await db.delete(kliphubProjectsTable).where(and(eq(kliphubProjectsTable.userId, userId), inArray(kliphubProjectsTable.id, projectIds)));
  }
  res.json({ deletedProjects: projectIds.length });
});

export default router;
