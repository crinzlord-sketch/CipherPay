import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { db, kliphubAssetsTable, kliphubJobsTable, kliphubProjectsTable, kliphubScenesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const OUTPUT_ROOT = path.resolve(process.cwd(), "generated", "kliphub");
const PUBLIC_PREFIX = "/api/kliphub/generated";
let running = false;

function safeToken(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "generation";
}

function hashPrompt(prompt: string) {
  return createHash("sha256").update(prompt).digest();
}

function ppmFrame(width: number, height: number, frame: number, total: number, seed: Buffer): Buffer {
  const out = Buffer.alloc(width * height * 3);
  const phase = (frame / Math.max(1, total - 1)) * Math.PI * 2;
  const a = seed[0] / 255;
  const b = seed[7] / 255;
  const c = seed[19] / 255;
  let p = 0;
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const wave = Math.sin(nx * 8 + phase * (1 + a * 2)) * 0.5 + 0.5;
      const glow = Math.exp(-(((nx - (0.25 + 0.5 * (Math.sin(phase * (0.7 + b)) * 0.5 + 0.5))) ** 2) +
        ((ny - (0.5 + 0.28 * Math.cos(phase * (0.5 + c)))) ** 2)) * 18);
      out[p++] = Math.max(0, Math.min(255, Math.round(18 + 72 * wave + 115 * glow)));
      out[p++] = Math.max(0, Math.min(255, Math.round(10 + 34 * (1 - nx) + 72 * glow)));
      out[p++] = Math.max(0, Math.min(255, Math.round(28 + 95 * (1 - ny) + 105 * (1 - wave) * glow)));
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), out]);
}

function runFfmpeg(args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error: any) => reject(new Error(error?.code === "ENOENT"
      ? "Local video encoder is unavailable on this server. The CPU engine is installed, but ffmpeg is required for MP4 output."
      : error?.message || "ffmpeg failed")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-1800) || `ffmpeg exited with code ${code}`)));
  });
}

async function generateImage(prompt: string, id: number) {
  const dir = path.join(OUTPUT_ROOT, "images");
  await fs.mkdir(dir, { recursive: true });
  const token = safeToken(prompt);
  const filename = `kh-${id}-${token}.svg`;
  const seed = hashPrompt(prompt);
  const hue = (seed[0] * 1.4 + seed[9]) % 360;
  const hue2 = (hue + 70 + seed[3] % 80) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="432" viewBox="0 0 768 432">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 10%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 18%)"/></linearGradient>
    <radialGradient id="orb"><stop stop-color="hsl(${hue} 95% 70%)" stop-opacity=".9"/><stop offset="1" stop-color="hsl(${hue2} 90% 45%)" stop-opacity="0"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="38"/></filter>
  </defs>
  <rect width="768" height="432" fill="url(#bg)"/>
  <circle cx="${180 + seed[4] * 1.4}" cy="${120 + seed[5] * .7}" r="190" fill="url(#orb)" filter="url(#blur)"/>
  <circle cx="${570 - seed[6] * .8}" cy="${300 - seed[7] * .5}" r="160" fill="url(#orb)" opacity=".55" filter="url(#blur)"/>
  <rect x="38" y="38" width="692" height="356" rx="28" fill="none" stroke="white" stroke-opacity=".16"/>
  <text x="58" y="350" fill="white" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="700">KLIPHUB LOCAL ENGINE</text>
  <text x="58" y="382" fill="white" fill-opacity=".62" font-family="Inter,Arial,sans-serif" font-size="14">${escapeXml(prompt.slice(0, 82))}</text>
</svg>`;
  await fs.writeFile(path.join(dir, filename), svg, "utf8");
  return { filename, url: `${PUBLIC_PREFIX}/images/${filename}`, mime: "image/svg+xml" };
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}

async function generateVideo(prompt: string, id: number) {
  const dir = path.join(OUTPUT_ROOT, "videos", `job-${id}`);
  await fs.mkdir(dir, { recursive: true });
  const seed = hashPrompt(prompt);
  const frames = 48;
  const width = 320;
  const height = 180;
  for (let i = 0; i < frames; i++) {
    await fs.writeFile(path.join(dir, `frame-${String(i).padStart(4, "0")}.ppm`), ppmFrame(width, height, i, frames, seed));
  }
  const filename = `kh-${id}-${safeToken(prompt)}.mp4`;
  await runFfmpeg([
    "-y", "-framerate", "12", "-i", "frame-%04d.ppm",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", filename,
  ], dir);
  for (const name of await fs.readdir(dir)) if (name.endsWith(".ppm")) await fs.unlink(path.join(dir, name));
  return { filename, url: `${PUBLIC_PREFIX}/videos/job-${id}/${filename}`, mime: "video/mp4" };
}

export async function runKlipHubGenerationJob(jobId: number) {
  const [job] = await db.update(kliphubJobsTable).set({
    status: "processing", progress: 5, provider: "kliphub-local-cpu", startedAt: new Date(), error: null,
  }).where(and(eq(kliphubJobsTable.id, jobId), eq(kliphubJobsTable.status, "queued"))).returning();
  if (!job) return;
  running = true;
  try {
    const [scene] = job.sceneId
      ? await db.select().from(kliphubScenesTable).where(and(eq(kliphubScenesTable.id, job.sceneId), eq(kliphubScenesTable.projectId, job.projectId))).limit(1)
      : [];
    const [project] = await db.select().from(kliphubProjectsTable).where(eq(kliphubProjectsTable.id, job.projectId)).limit(1);
    const prompt = scene?.prompt || project?.prompt || "cinematic abstract motion";
    await db.update(kliphubJobsTable).set({ progress: 20 }).where(eq(kliphubJobsTable.id, jobId));

    let output;
    if (job.type === "image") {
      output = await generateImage(prompt, jobId);
    } else {
      output = await generateVideo(prompt, jobId);
    }

    await db.update(kliphubJobsTable).set({
      status: "completed", progress: 100, finishedAt: new Date(),
      outputJson: JSON.stringify(output),
    }).where(eq(kliphubJobsTable.id, jobId));

    if (scene) {
      await db.update(kliphubScenesTable).set({ status: "completed", videoUrl: output.url }).where(eq(kliphubScenesTable.id, scene.id));
    }
    await db.insert(kliphubAssetsTable).values({
      userId: job.userId, projectId: job.projectId,
      name: output.filename, type: output.mime === "video/mp4" ? "video" : "image", url: output.url,
    });
    await db.update(kliphubProjectsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(kliphubProjectsTable.id, job.projectId));
  } catch (error: any) {
    await db.update(kliphubJobsTable).set({
      status: "failed", progress: 100, finishedAt: new Date(),
      error: error?.message || "Local generation failed",
    }).where(eq(kliphubJobsTable.id, jobId));
  } finally {
    running = false;
  }
}

export function startKlipHubLocalEngine() {
  const tick = async () => {
    if (running) return;
    const [job] = await db.select().from(kliphubJobsTable)
      .where(eq(kliphubJobsTable.status, "queued")).orderBy(kliphubJobsTable.createdAt).limit(1);
    if (job) void runKlipHubGenerationJob(job.id);
  };
  void tick();
  setInterval(() => void tick(), 2500);
}

export function kliphubGeneratedPath(parts: string[]) {
  const target = path.resolve(OUTPUT_ROOT, ...parts);
  if (!target.startsWith(OUTPUT_ROOT + path.sep)) return null;
  return target;
}

export function kliphubOutputExists() {
  return fsSync.existsSync(OUTPUT_ROOT);
}
