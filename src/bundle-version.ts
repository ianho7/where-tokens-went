import { readFile, readdir, realpath } from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

export const AUDIT_SCHEMA_VERSION = 1;
export const INSTALL_HINT = "Run npm run install-local.";
export const REINSTALL_HINT = "Reinstall the where-tokens-went Skill package.";

export const REQUIRED_PACKAGE_FILES = [
  "SKILL.md",
  "scripts/where-tokens-went.js",
  "scripts/runtime/cli.js",
  "references/report-synthesis.md",
  "references/key-session-analysis.md",
  "references/skill-insights.md",
] as const;

export interface BundleVersion {
  productVersion: string;
  bundleVersion: string;
  auditSchemaVersion: number;
}

export function isBundleVersion(value: unknown): value is BundleVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.productVersion === "string"
    && candidate.productVersion.length > 0
    && typeof candidate.bundleVersion === "string"
    && candidate.bundleVersion.length > 0
    && candidate.auditSchemaVersion === AUDIT_SCHEMA_VERSION;
}

async function readBundleVersionFile(filePath: string): Promise<BundleVersion | null> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return isBundleVersion(value) ? value : null;
  } catch {
    return null;
  }
}

function isDescendantOf(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function collectBundleFiles(skillRoot: string): Promise<Array<{ relative: string; path: string }>> {
  const realSkillRoot = await realpath(skillRoot);
  const files: Array<{ relative: string; path: string }> = [];

  const visit = async (current: string, relative: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const normalizedRelative = entryRelative.replaceAll("\\", "/");

      if (normalizedRelative === "bundle-version.json") {
        continue;
      }

      if (entry.isSymbolicLink()) {
        let realTarget: string;
        try {
          realTarget = await realpath(fullPath);
        } catch {
          throw new Error(`where-tokens-went Skill preflight failed: broken symlink at ${normalizedRelative}`);
        }
        if (!isDescendantOf(realSkillRoot, realTarget) && realTarget !== realSkillRoot) {
          throw new Error(`where-tokens-went Skill preflight failed: symlink ${normalizedRelative} escapes package root`);
        }
      }

      if (entry.isDirectory()) {
        await visit(fullPath, entryRelative);
      } else if (entry.isFile()) {
        files.push({ relative: normalizedRelative, path: fullPath });
      }
    }
  };

  await visit(skillRoot, "");
  files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));

  const presentFiles = new Set(files.map((file) => file.relative));
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!presentFiles.has(required)) {
      throw new Error(`where-tokens-went Skill preflight failed: missing required package file ${required}`);
    }
  }

  return files;
}

export async function computeBundleDigest(skillRoot: string): Promise<string> {
  const entries = await collectBundleFiles(skillRoot);
  const digest = createHash("sha256");
  for (const entry of entries) {
    const contents = await readFile(entry.path);
    digest.update(entry.relative, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(contents.byteLength), "utf8");
    digest.update("\0", "utf8");
    digest.update(contents);
    digest.update("\0", "utf8");
  }
  return digest.digest("hex");
}

export async function isDevelopmentRepo(skillRoot: string): Promise<boolean> {
  try {
    const candidateRepo = path.resolve(skillRoot, "../..");
    const pkgPath = path.join(candidateRepo, "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    return pkg && pkg.name === "where-tokens-went";
  } catch {
    return false;
  }
}

export function isPackagedSkillDirectory(dir: string): boolean {
  const parentName = path.basename(path.resolve(dir, ".."));
  const currentName = path.basename(dir);
  return currentName === "runtime" && parentName === "scripts";
}

export async function resolveSkillRoot(candidate?: string): Promise<string> {
  if (candidate) {
    const resolved = path.resolve(candidate);
    const bundle = await readBundleVersionFile(path.join(resolved, "bundle-version.json"));
    if (bundle) return resolved;
    const subBundle = await readBundleVersionFile(path.join(resolved, "skills", "where-tokens-went", "bundle-version.json"));
    if (subBundle) return path.join(resolved, "skills", "where-tokens-went");
    return resolved;
  }

  // Normal invocation of an installed Skill package: the invoking package is self-authoritative
  // and must never be masked or redirected by ambient environment variables.
  if (isPackagedSkillDirectory(__dirname)) {
    return path.resolve(__dirname, "../..");
  }

  if (process.env.WHERE_TOKENS_WENT_SKILL_ROOT) {
    return path.resolve(process.env.WHERE_TOKENS_WENT_SKILL_ROOT);
  }

  if (process.env.WHERE_TOKENS_WENT_REPO_ROOT) {
    const envRepoDist = path.join(path.resolve(process.env.WHERE_TOKENS_WENT_REPO_ROOT), "skills", "where-tokens-went");
    const envBundle = await readBundleVersionFile(path.join(envRepoDist, "bundle-version.json"));
    if (envBundle) return envRepoDist;
  }

  // Check two levels up from current file (e.g. <skillRoot>/scripts/runtime/cli.js -> <skillRoot>)
  const directSkillRoot = path.resolve(__dirname, "../..");
  const directBundle = await readBundleVersionFile(path.join(directSkillRoot, "bundle-version.json"));
  if (directBundle) {
    return directSkillRoot;
  }

  // Check development repository root (e.g. <repoRoot>/dist/src/cli.js -> <repoRoot>/skills/where-tokens-went)
  const repoDistribution = path.join(directSkillRoot, "skills", "where-tokens-went");
  const repoBundle = await readBundleVersionFile(path.join(repoDistribution, "bundle-version.json"));
  if (repoBundle) {
    return repoDistribution;
  }

  throw new Error("where-tokens-went Skill preflight failed: package root cannot be resolved.");
}

export async function readCurrentBundleVersion(explicitSkillRoot?: string): Promise<BundleVersion | null> {
  try {
    const skillRoot = await resolveSkillRoot(explicitSkillRoot);
    return await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
  } catch {
    return null;
  }
}

export async function verifySkillPackage(explicitSkillRoot?: string): Promise<BundleVersion> {
  const skillRoot = await resolveSkillRoot(explicitSkillRoot);
  const isDev = await isDevelopmentRepo(skillRoot);
  const hint = isDev ? INSTALL_HINT : REINSTALL_HINT;

  const bundle = await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
  if (!bundle) {
    throw new Error(`where-tokens-went Skill version preflight failed: bundle-version.json is missing or invalid. ${hint}`);
  }

  if (bundle.auditSchemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new Error(`where-tokens-went Skill version preflight failed: unsupported auditSchemaVersion ${bundle.auditSchemaVersion}. ${hint}`);
  }

  const parts = bundle.bundleVersion.split("+");
  const expectedDigest = parts[1];
  if (!expectedDigest) {
    throw new Error(`where-tokens-went Skill version preflight failed: invalid bundleVersion format ${bundle.bundleVersion}. ${hint}`);
  }

  let actualDigest: string;
  try {
    actualDigest = await computeBundleDigest(skillRoot);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${msg} ${hint}`);
  }

  if (actualDigest !== expectedDigest) {
    throw new Error(`where-tokens-went Skill version preflight failed: package content digest mismatch. ${hint}`);
  }

  return bundle;
}

export async function verifyInstalledSkill(explicitSkillRoot?: string): Promise<BundleVersion> {
  return verifySkillPackage(explicitSkillRoot);
}
