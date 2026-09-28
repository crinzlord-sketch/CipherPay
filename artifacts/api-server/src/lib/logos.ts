import path from "path";
import fs from "fs";

// Self-hosted VAS brand logos (mobile networks + bill providers). The image
// files live in `assets/logos/<id>.<ext>` next to the server. Dev runs with cwd
// at the api-server dir; prod runs from the repo root — resolve both.
const LOGO_DIR_CANDIDATES = [
  path.resolve(process.cwd(), "assets", "logos"),
  path.resolve(process.cwd(), "artifacts", "api-server", "assets", "logos"),
];

export const LOGOS_DIR: string =
  LOGO_DIR_CANDIDATES.find((d) => fs.existsSync(d)) ?? LOGO_DIR_CANDIDATES[0]!;

// Extensions vary per logo (png/jpg/webp), so build an id → filename map once at
// startup and resolve by id thereafter.
const idToFile = new Map<string, string>();
try {
  for (const f of fs.readdirSync(LOGOS_DIR)) {
    const m = f.match(/^(.+)\.(png|jpe?g|webp)$/i);
    if (m) idToFile.set(m[1]!, f);
  }
} catch {
  // logos dir missing in some environments — logoPath() then returns null.
}

// Returns the public relative URL for a logo id, or null when we have none.
export function logoPath(id: string): string | null {
  const f = idToFile.get(id);
  if (!f) return null;
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/api/assets/logos/${f}`;
}
