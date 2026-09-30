"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_PACKAGE_FILES = exports.REINSTALL_HINT = exports.INSTALL_HINT = exports.AUDIT_SCHEMA_VERSION = void 0;
exports.isBundleVersion = isBundleVersion;
exports.collectBundleFiles = collectBundleFiles;
exports.computeBundleDigest = computeBundleDigest;
exports.isDevelopmentRepo = isDevelopmentRepo;
exports.isPackagedSkillDirectory = isPackagedSkillDirectory;
exports.resolveSkillRoot = resolveSkillRoot;
exports.readCurrentBundleVersion = readCurrentBundleVersion;
exports.verifySkillPackage = verifySkillPackage;
exports.verifyInstalledSkill = verifyInstalledSkill;
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
exports.AUDIT_SCHEMA_VERSION = 1;
exports.INSTALL_HINT = "Run npm run install-local.";
exports.REINSTALL_HINT = "Reinstall the where-tokens-went Skill package.";
exports.REQUIRED_PACKAGE_FILES = [
    "SKILL.md",
    "scripts/where-tokens-went.js",
    "scripts/runtime/cli.js",
    "references/report-synthesis.md",
    "references/key-session-analysis.md",
    "references/skill-insights.md",
];
function isBundleVersion(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const candidate = value;
    return typeof candidate.productVersion === "string"
        && candidate.productVersion.length > 0
        && typeof candidate.bundleVersion === "string"
        && candidate.bundleVersion.length > 0
        && candidate.auditSchemaVersion === exports.AUDIT_SCHEMA_VERSION;
}
async function readBundleVersionFile(filePath) {
    try {
        const value = JSON.parse(await (0, promises_1.readFile)(filePath, "utf8"));
        return isBundleVersion(value) ? value : null;
    }
    catch {
        return null;
    }
}
function isDescendantOf(parentPath, targetPath) {
    const relative = path.relative(parentPath, targetPath);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function collectBundleFiles(skillRoot) {
    const realSkillRoot = await (0, promises_1.realpath)(skillRoot);
    const files = [];
    const visit = async (current, relative) => {
        const entries = (await (0, promises_1.readdir)(current, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
            const normalizedRelative = entryRelative.replaceAll("\\", "/");
            if (normalizedRelative === "bundle-version.json") {
                continue;
            }
            if (entry.isSymbolicLink()) {
                let realTarget;
                try {
                    realTarget = await (0, promises_1.realpath)(fullPath);
                }
                catch {
                    throw new Error(`where-tokens-went Skill preflight failed: broken symlink at ${normalizedRelative}`);
                }
                if (!isDescendantOf(realSkillRoot, realTarget) && realTarget !== realSkillRoot) {
                    throw new Error(`where-tokens-went Skill preflight failed: symlink ${normalizedRelative} escapes package root`);
                }
            }
            if (entry.isDirectory()) {
                await visit(fullPath, entryRelative);
            }
            else if (entry.isFile()) {
                files.push({ relative: normalizedRelative, path: fullPath });
            }
        }
    };
    await visit(skillRoot, "");
    files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));
    const presentFiles = new Set(files.map((file) => file.relative));
    for (const required of exports.REQUIRED_PACKAGE_FILES) {
        if (!presentFiles.has(required)) {
            throw new Error(`where-tokens-went Skill preflight failed: missing required package file ${required}`);
        }
    }
    return files;
}
async function computeBundleDigest(skillRoot) {
    const entries = await collectBundleFiles(skillRoot);
    const digest = (0, node_crypto_1.createHash)("sha256");
    for (const entry of entries) {
        const contents = await (0, promises_1.readFile)(entry.path);
        digest.update(entry.relative, "utf8");
        digest.update("\0", "utf8");
        digest.update(String(contents.byteLength), "utf8");
        digest.update("\0", "utf8");
        digest.update(contents);
        digest.update("\0", "utf8");
    }
    return digest.digest("hex");
}
async function isDevelopmentRepo(skillRoot) {
    try {
        const candidateRepo = path.resolve(skillRoot, "../..");
        const pkgPath = path.join(candidateRepo, "package.json");
        const raw = await (0, promises_1.readFile)(pkgPath, "utf8");
        const pkg = JSON.parse(raw);
        return pkg && pkg.name === "where-tokens-went";
    }
    catch {
        return false;
    }
}
function isPackagedSkillDirectory(dir) {
    const parentName = path.basename(path.resolve(dir, ".."));
    const currentName = path.basename(dir);
    return currentName === "runtime" && parentName === "scripts";
}
async function resolveSkillRoot(candidate) {
    if (candidate) {
        const resolved = path.resolve(candidate);
        const bundle = await readBundleVersionFile(path.join(resolved, "bundle-version.json"));
        if (bundle)
            return resolved;
        const subBundle = await readBundleVersionFile(path.join(resolved, "skills", "where-tokens-went", "bundle-version.json"));
        if (subBundle)
            return path.join(resolved, "skills", "where-tokens-went");
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
        if (envBundle)
            return envRepoDist;
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
async function readCurrentBundleVersion(explicitSkillRoot) {
    try {
        const skillRoot = await resolveSkillRoot(explicitSkillRoot);
        return await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
    }
    catch {
        return null;
    }
}
async function verifySkillPackage(explicitSkillRoot) {
    const skillRoot = await resolveSkillRoot(explicitSkillRoot);
    const isDev = await isDevelopmentRepo(skillRoot);
    const hint = isDev ? exports.INSTALL_HINT : exports.REINSTALL_HINT;
    const bundle = await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
    if (!bundle) {
        throw new Error(`where-tokens-went Skill version preflight failed: bundle-version.json is missing or invalid. ${hint}`);
    }
    if (bundle.auditSchemaVersion !== exports.AUDIT_SCHEMA_VERSION) {
        throw new Error(`where-tokens-went Skill version preflight failed: unsupported auditSchemaVersion ${bundle.auditSchemaVersion}. ${hint}`);
    }
    const parts = bundle.bundleVersion.split("+");
    const expectedDigest = parts[1];
    if (!expectedDigest) {
        throw new Error(`where-tokens-went Skill version preflight failed: invalid bundleVersion format ${bundle.bundleVersion}. ${hint}`);
    }
    let actualDigest;
    try {
        actualDigest = await computeBundleDigest(skillRoot);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`${msg} ${hint}`);
    }
    if (actualDigest !== expectedDigest) {
        throw new Error(`where-tokens-went Skill version preflight failed: package content digest mismatch. ${hint}`);
    }
    return bundle;
}
async function verifyInstalledSkill(explicitSkillRoot) {
    return verifySkillPackage(explicitSkillRoot);
}
