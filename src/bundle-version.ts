import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

export const AUDIT_SCHEMA_VERSION = 1;
export const INSTALL_HINT = "Run npm run install-local.";

export interface BundleVersion {
  productVersion: string;
  bundleVersion: string;
  auditSchemaVersion: number;
}

function isBundleVersion(value: unknown): value is BundleVersion {
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

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string, relative: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const next = path.join(directory, entry.name);
      const nextRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(next, nextRelative);
      else if (entry.isFile()) result.push(nextRelative);
    }
  };
  await visit(root, "");
  return result.sort();
}

async function verifyInstalledContent(expectedRoot: string, actualRoot: string, label: string): Promise<void> {
  let expectedFiles: string[];
  let actualFiles: string[];
  try {
    [expectedFiles, actualFiles] = await Promise.all([listFiles(expectedRoot), listFiles(actualRoot)]);
  } catch {
    throw new Error(`where-tokens-went Skill version preflight failed: ${label} installed content is unavailable. ${INSTALL_HINT}`);
  }
  if (expectedFiles.join("\n") !== actualFiles.join("\n")) {
    throw new Error(`where-tokens-went Skill version preflight failed: ${label} installed file set differs from the repository distribution. ${INSTALL_HINT}`);
  }
  for (const relative of expectedFiles) {
    const expected = await readFile(path.join(expectedRoot, relative));
    const actual = await readFile(path.join(actualRoot, relative));
    if (!expected.equals(actual)) {
      throw new Error(`where-tokens-went Skill version preflight failed: ${label} installed content differs at ${relative}. ${INSTALL_HINT}`);
    }
  }
}

function ancestors(start: string): string[] {
  const result: string[] = [];
  let current = path.resolve(start);
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) return result;
    current = parent;
  }
}

async function findRepositoryRoot(): Promise<string | null> {
  const starts = [
    ...(process.env.WHERE_TOKENS_WENT_REPO_ROOT ? [process.env.WHERE_TOKENS_WENT_REPO_ROOT] : []),
    process.cwd(),
    path.resolve(__dirname, "../.."),
    path.resolve(__dirname, "../../.."),
  ];
  for (const start of starts) {
    for (const candidate of ancestors(start)) {
      const bundle = await readBundleVersionFile(path.join(candidate, "skills", "where-tokens-went", "bundle-version.json"));
      if (bundle) return candidate;
    }
  }
  return null;
}

export async function readCurrentBundleVersion(): Promise<BundleVersion | null> {
  const candidates = [
    path.resolve(__dirname, "../../bundle-version.json"),
    path.resolve(__dirname, "../../skills/where-tokens-went/bundle-version.json"),
    ...(process.env.WHERE_TOKENS_WENT_REPO_ROOT
      ? [path.resolve(process.env.WHERE_TOKENS_WENT_REPO_ROOT, "skills/where-tokens-went/bundle-version.json")]
      : []),
  ];
  for (const filePath of candidates) {
    const bundle = await readBundleVersionFile(filePath);
    if (bundle) return bundle;
  }
  return null;
}

export async function verifyInstalledSkill(): Promise<BundleVersion> {
  const repositoryRoot = await findRepositoryRoot();
  if (!repositoryRoot) throw new Error(`where-tokens-went Skill version preflight failed: repository distribution bundle is unavailable. ${INSTALL_HINT}`);
  const expected = await readBundleVersionFile(path.join(repositoryRoot, "skills", "where-tokens-went", "bundle-version.json"));
  if (!expected) throw new Error(`where-tokens-went Skill version preflight failed: repository distribution bundle is invalid. ${INSTALL_HINT}`);
  const locations = [
    [".agents", path.join(repositoryRoot, ".agents", "skills", "where-tokens-went")],
    [".claude", path.join(repositoryRoot, ".claude", "skills", "where-tokens-went")],
  ] as const;
  for (const [label, skillRoot] of locations) {
    const actual = await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
    if (!actual) throw new Error(`where-tokens-went Skill version preflight failed: ${label} installed bundle is missing or invalid. ${INSTALL_HINT}`);
    for (const field of ["productVersion", "bundleVersion", "auditSchemaVersion"] as const) {
      if (actual[field] !== expected[field]) {
        throw new Error(`where-tokens-went Skill version preflight failed: ${label} ${field} does not match the repository distribution bundle. ${INSTALL_HINT}`);
      }
    }
    await verifyInstalledContent(path.join(repositoryRoot, "skills", "where-tokens-went"), skillRoot, label);
  }
  return expected;
}
