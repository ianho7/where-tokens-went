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
exports.INSTALL_HINT = exports.AUDIT_SCHEMA_VERSION = void 0;
exports.readCurrentBundleVersion = readCurrentBundleVersion;
exports.verifyInstalledSkill = verifyInstalledSkill;
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
exports.AUDIT_SCHEMA_VERSION = 1;
exports.INSTALL_HINT = "Run npm run install-local.";
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
function ancestors(start) {
    const result = [];
    let current = path.resolve(start);
    while (true) {
        result.push(current);
        const parent = path.dirname(current);
        if (parent === current)
            return result;
        current = parent;
    }
}
async function findRepositoryRoot() {
    const starts = [
        ...(process.env.WHERE_TOKENS_WENT_REPO_ROOT ? [process.env.WHERE_TOKENS_WENT_REPO_ROOT] : []),
        process.cwd(),
        path.resolve(__dirname, "../.."),
        path.resolve(__dirname, "../../.."),
    ];
    for (const start of starts) {
        for (const candidate of ancestors(start)) {
            const bundle = await readBundleVersionFile(path.join(candidate, "skills", "where-tokens-went", "bundle-version.json"));
            if (bundle)
                return candidate;
        }
    }
    return null;
}
async function readCurrentBundleVersion() {
    const candidates = [
        path.resolve(__dirname, "../../bundle-version.json"),
        path.resolve(__dirname, "../../skills/where-tokens-went/bundle-version.json"),
        ...(process.env.WHERE_TOKENS_WENT_REPO_ROOT
            ? [path.resolve(process.env.WHERE_TOKENS_WENT_REPO_ROOT, "skills/where-tokens-went/bundle-version.json")]
            : []),
    ];
    for (const filePath of candidates) {
        const bundle = await readBundleVersionFile(filePath);
        if (bundle)
            return bundle;
    }
    return null;
}
async function verifyInstalledSkill() {
    const repositoryRoot = await findRepositoryRoot();
    if (!repositoryRoot)
        throw new Error(`where-tokens-went Skill version preflight failed: repository distribution bundle is unavailable. ${exports.INSTALL_HINT}`);
    const expected = await readBundleVersionFile(path.join(repositoryRoot, "skills", "where-tokens-went", "bundle-version.json"));
    if (!expected)
        throw new Error(`where-tokens-went Skill version preflight failed: repository distribution bundle is invalid. ${exports.INSTALL_HINT}`);
    const locations = [
        [".agents", path.join(repositoryRoot, ".agents", "skills", "where-tokens-went")],
        [".claude", path.join(repositoryRoot, ".claude", "skills", "where-tokens-went")],
    ];
    for (const [label, skillRoot] of locations) {
        const actual = await readBundleVersionFile(path.join(skillRoot, "bundle-version.json"));
        if (!actual)
            throw new Error(`where-tokens-went Skill version preflight failed: ${label} installed bundle is missing or invalid. ${exports.INSTALL_HINT}`);
        for (const field of ["productVersion", "bundleVersion", "auditSchemaVersion"]) {
            if (actual[field] !== expected[field]) {
                throw new Error(`where-tokens-went Skill version preflight failed: ${label} ${field} does not match the repository distribution bundle. ${exports.INSTALL_HINT}`);
            }
        }
    }
    return expected;
}
