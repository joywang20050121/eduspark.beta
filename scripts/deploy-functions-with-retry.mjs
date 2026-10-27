import {spawnSync} from "node:child_process";
import process from "node:process";

const firebaseCommand = process.platform === "win32" ?
  "functions/node_modules/.bin/firebase.cmd" :
  "./functions/node_modules/.bin/firebase";
const projectId = process.env.FIREBASE_PROJECT_ID || "coespark-a3f6e";
const functionNames = process.argv.slice(2)
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter(Boolean);

if (!functionNames.length || functionNames.some((name) => !/^[A-Za-z][A-Za-z0-9]*$/.test(name))) {
  console.error("請提供有效的 Firebase Function 名稱");
  process.exit(2);
}

const only = functionNames.map((name) => `functions:${name}`).join(",");
const maxAttempts = 3;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`Firebase Functions 部署嘗試 ${attempt}/${maxAttempts}`);
  const result = spawnSync(firebaseCommand, [
    "deploy",
    "--project", projectId,
    "--only", only,
    "--non-interactive",
  ], {env: process.env, stdio: "inherit"});

  if (result.error) console.error(result.error.message);
  if (!result.error && result.status === 0) process.exit(0);
  if (attempt === maxAttempts) process.exit(result.status ?? 1);

  const delaySeconds = attempt * 30;
  console.warn(`部署失敗，${delaySeconds} 秒後重試`);
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}
