import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/Code.js",
  format: "iife",
  globalName: "CalendarShare",
  platform: "neutral",
  target: "es2020",
  legalComments: "none",
  sourcemap: false,
  treeShaking: true,
  footer: {
    js: `
function setup() { return CalendarShare.setup(); }
function listCandidateCalendars() { return CalendarShare.listCandidateCalendars(); }
function phase0DryRun() { return CalendarShare.phase0DryRun(); }
function syncCombinedCalendar() { return CalendarShare.syncCombinedCalendar(); }
function healthCheck() { return CalendarShare.healthCheck(); }
function doGet() { return CalendarShare.doGet(); }
function getDashboardState() { return CalendarShare.getDashboardState(); }
function initializeDashboard(input) { return CalendarShare.initializeDashboard(input); }
function saveDashboardConfig(input) { return CalendarShare.saveDashboardConfig(input); }
function runDashboardDryRun() { return CalendarShare.runDashboardDryRun(); }
function runDashboardSync() { return CalendarShare.runDashboardSync(); }
`,
  },
});

// clasp's rootDir is dist, so the Apps Script manifest must be deployed with
// the bundle rather than left only at the repository root.
await cp("appsscript.json", "dist/appsscript.json");
await cp("src/ui/Index.html", "dist/Index.html");

console.log("Built dist/Code.js and dist/Index.html for Apps Script");
