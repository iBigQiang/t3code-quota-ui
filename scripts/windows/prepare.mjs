import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { buildInjectedHeadBlock } from "../patch-asar.mjs";

const client = path.resolve(process.argv[2] ?? ".");
const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync("git", ["apply", "--ignore-space-change", path.join(here, "client.patch")], { cwd: client, stdio: "inherit" });
execFileSync(process.execPath, [path.join(here, "../apply-source-patches.mjs"), client], { stdio: "inherit" });

// Use the complete v1.4 renderer assets before Electron archives the client.
// Windows account storage stays with the native upstream backend.
const entry = path.join(client, "apps/web/index.html");
const original = readFileSync(entry, "utf8");
const injected = /<!-- T3_QUOTA_UI_START -->[\s\S]*?<!-- T3_QUOTA_UI_END -->/g;
if ([...original.matchAll(injected)].length !== 1) throw new Error("Expected one quota head block");
const block = buildInjectedHeadBlock("zh");
for (const [, body] of block.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new Script(body);
writeFileSync(entry, original.replace(injected, () => block));
copyFileSync(path.join(here, "../../LICENSE"), path.join(client, "apps/desktop/resources/LICENSE-quota-ui.txt"));
