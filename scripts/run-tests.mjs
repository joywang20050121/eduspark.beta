import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const firebaseCommand = process.platform === "win32" ?
  "functions/node_modules/.bin/firebase.cmd" :
  "./functions/node_modules/.bin/firebase";

const environment = {...process.env};
const javaCheck = spawnSync("java", ["-version"], {env: environment, stdio: "ignore"});
if (javaCheck.status !== 0) {
  const javaDirectories = [
    "/opt/homebrew/opt/openjdk@21/bin",
    "/usr/local/opt/openjdk@21/bin",
  ];
  const javaDirectory = javaDirectories.find((directory) => existsSync(`${directory}/java`));
  if (javaDirectory) {
    environment.PATH = `${javaDirectory}${process.platform === "win32" ? ";" : ":"}${environment.PATH ?? ""}`;
  }
}

const commands = [
  [npmCommand, ["--prefix", "functions", "run", "check"]],
  [npmCommand, ["--prefix", "functions", "run", "build"]],
  [firebaseCommand, [
    "emulators:exec",
    "--project", "demo-eduspark",
    "--only", "auth,functions,firestore,hosting",
    "npm --prefix functions run test:functions:run && npm --prefix functions test && npm --prefix e2e test",
  ]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {env: environment, stdio: "inherit"});
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
