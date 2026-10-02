type Txt2ImgWorkerClient = any;
let client: Txt2ImgWorkerClient | null = null;
let loaded = false;

export type LocalImageProgress = {
  phase?: string;
  pct?: number;
  message?: string;
  bytesDownloaded?: number;
  totalBytesExpected?: number;
};

async function getClient() {
  if (!client) { const mod: any = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/web-txt2img@0.3.1/dist/index.js"); client = mod.Txt2ImgWorkerClient.createDefault(); }
  return client;
}

export async function detectLocalImageEngine() {
  const c = await getClient();
  return c.detect();
}

export async function generateLocalImage(prompt: string, onProgress?: (p: LocalImageProgress) => void) {
  const c = await getClient();
  const caps = await c.detect();
  if (!caps.webgpu) {
    throw new Error("KlipHub local image generation needs a WebGPU-capable browser. No server API is being used.");
  }
  if (!loaded) {
    const loadedResult = await c.load("sd-turbo", { backendPreference: ["webgpu"] }, (p: any) => onProgress?.(p));
    if (!loadedResult?.ok) throw new Error(loadedResult?.message || "The local image model could not load.");
    loaded = true;
  }
  const { promise } = c.generate(
    { prompt, seed: Math.floor(Math.random() * 2147483647) },
    (p: any) => onProgress?.(p),
    { busyPolicy: "queue", debounceMs: 100 },
  );
  const result: any = await promise;
  if (!result?.ok) throw new Error(result?.message || "Local image generation failed.");
  return { blob: result.blob as Blob, timeMs: result.timeMs as number };
}
