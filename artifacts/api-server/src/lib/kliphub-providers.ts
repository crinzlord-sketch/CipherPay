import fs from "node:fs";
import path from "node:path";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

function key(): string {
  const value = process.env.RUNWAY_API_KEY?.trim();
  if (!value) throw new Error("RUNWAY_API_KEY is not configured.");
  return value;
}

async function runway(pathname: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(RUNWAY_BASE + pathname, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "X-Runway-Version": RUNWAY_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || body?.raw || `Runway request failed (${response.status}).`;
    throw new Error(String(message));
  }
  return body;
}

export async function createRunwayImage(prompt: string, ratio = "1920:1080") {
  return runway("/text_to_image", {
    method: "POST",
    body: JSON.stringify({
      model: "gen4_image",
      promptText: prompt.slice(0, 32000),
      ratio,
      outputCount: 1,
    }),
  });
}

export async function createRunwayImageToVideo(promptImage: string, promptText: string, duration = 5, ratio = "1280:720") {
  return runway("/image_to_video", {
    method: "POST",
    body: JSON.stringify({
      model: "gen4.5",
      promptImage,
      promptText: promptText.slice(0, 32000),
      ratio,
      duration: Math.max(5, Math.min(10, duration)),
    }),
  });
}

export async function getRunwayTask(taskId: string) {
  return runway(`/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
}

export async function downloadRunwayOutput(url: string, directory: string, basename: string): Promise<{url: string; type: "image" | "video"}> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download generated media (${response.status}).`);
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const type = contentType.startsWith("video/") ? "video" : "image";
  const ext = type === "video" ? (contentType.includes("webm") ? "webm" : "mp4") : (contentType.includes("jpeg") ? "jpg" : "png");
  const actualDirectory = path.join(path.dirname(directory), type === "video" ? "videos" : "images");
  await fs.promises.mkdir(actualDirectory, { recursive: true });
  const safe = basename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  const filename = `${Date.now()}-${safe}.${ext}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(path.join(actualDirectory, filename), buffer);
  return {
    url: `/api/kliphub/generated/${type === "video" ? "videos" : "images"}/${filename}`,
    type,
  };
}
