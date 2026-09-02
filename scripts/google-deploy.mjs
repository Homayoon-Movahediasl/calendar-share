import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const LOCAL_STATE_FILE = ".calendarshare.local.json";
export const API_SETTINGS_URL = "https://script.google.com/home/usersettings";

function defaultRunner(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
}

function command(runner, args) {
  try {
    return runner("npx", ["clasp", ...args]);
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
    if (/Apps Script API|script.google.com\/home\/usersettings/i.test(detail)) {
      throw new Error(`${detail.trim()}\n\nEnable the Apps Script API here, then rerun: ${API_SETTINGS_URL}`);
    }
    throw new Error(detail.trim() || `clasp ${args.join(" ")} failed`);
  }
}

function ensureClaspAuth(runner) {
  try {
    command(runner, ["show-authorized-user"]);
  } catch {
    console.log("clasp is not logged in. Opening Google authorization...");
    command(runner, ["login"]);
  }
}

export function readLocalState(file = LOCAL_STATE_FILE, fs = { existsSync, readFileSync }) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error(`Cannot read ${file}; fix or remove the invalid JSON.`); }
}

export function writeLocalState(state, file = LOCAL_STATE_FILE, fs = { writeFileSync }) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function parseDeployment(outputText) {
  // clasp versions differ: some print JSON, others print a human-readable URL.
  let parsed;
  try { parsed = JSON.parse(outputText); } catch { parsed = null; }
  const text = parsed ? JSON.stringify(parsed) : outputText;
  const deploymentId = parsed?.deploymentId ?? parsed?.deployment?.deploymentId
    ?? text.match(/AKfy[a-zA-Z0-9_-]+/)?.[0];
  const url = parsed?.url ?? parsed?.deployment?.url
    ?? outputText.match(/https:\/\/script\.google\.com\/macros\/s\/[^\s)]+\/exec/)?.[0];
  if (!deploymentId) throw new Error(`Could not find a deployment ID in clasp output:\n${outputText}`);
  return { deploymentId, ...(url ? { url } : {}) };
}

export function parseDeployments(outputText) {
  return outputText.split("\n").map((line) => {
    const id = line.match(/(AKfy[a-zA-Z0-9_-]+)/)?.[1];
    if (!id) return null;
    const version = line.match(/@(?:HEAD|([0-9]+))/)?.[1] ?? "HEAD";
    const description = line.replace(id, "").replace(/@(?:HEAD|[0-9]+)/, "").trim();
    return { deploymentId: id, version, description };
  }).filter(Boolean);
}

async function chooseDeployment(deployments, prompt = async () => undefined) {
  if (deployments.length === 1) return deployments[0];
  if (!process.stdin.isTTY) throw new Error("No local deployment state found. Run setup:google interactively once to select a deployment.");
  const answer = await prompt(deployments);
  const selected = deployments[Number(answer) - 1];
  if (!selected) throw new Error("Invalid deployment selection.");
  return selected;
}

export async function deploy({ update = false, runner = defaultRunner, fs = { existsSync, readFileSync, writeFileSync }, prompt } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("CalendarShare requires Node.js 20 or newer.");
  ensureClaspAuth(runner);
  let createdProject = false;
  if (!fs.existsSync(".clasp.json")) {
    console.log("No .clasp.json found. Creating a new standalone Apps Script project...");
    command(runner, ["create", "--type", "standalone", "--title", "CalendarShare", "--rootDir", "dist"]);
    createdProject = true;
  }
  runner("npm", ["run", "build"]);
  command(runner, ["push", "--force"]);
  const state = readLocalState(LOCAL_STATE_FILE, fs);
  let deployment = state.deploymentId ? { deploymentId: state.deploymentId, url: state.url } : null;
  if (!deployment && !createdProject) {
    const existing = parseDeployments(command(runner, ["deployments"]));
    deployment = await chooseDeployment(existing, prompt ?? (async (items) => {
      const rl = createInterface({ input, output });
      items.forEach((item, index) => console.log(`  ${index + 1}. ${item.description || "(no description)"} [${item.version}]`));
      const answer = await rl.question("Select the deployment to update: ");
      rl.close();
      return answer;
    }));
  }
  const result = deployment
    ? command(runner, ["update-deployment", deployment.deploymentId, "--description", "CalendarShare production"])
    : command(runner, ["deploy", "--description", "CalendarShare production"]);
  const details = parseDeployment(result || JSON.stringify(deployment));
  const saved = {
    deploymentId: details.deploymentId,
    url: details.url || deployment?.url || `https://script.google.com/macros/s/${details.deploymentId}/exec`,
  };
  writeLocalState(saved, LOCAL_STATE_FILE, fs);
  console.log(`Deployment updated: ${saved.url || saved.deploymentId}`);
  return saved;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deploy({ update: process.argv.includes("--update") }).catch((error) => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
