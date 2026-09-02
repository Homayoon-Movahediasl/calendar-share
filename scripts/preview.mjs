// Serves a standalone copy of the dashboard with a mocked google.script.run
// bridge and deterministic synthetic data. Useful for trying the dashboard,
// or for capturing documentation screenshots, without a live Google account
// or real calendar data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

const DEMO_STATE = {
  destination: {
    id: "destination-combined",
    name: "CalendarShare – Combined",
    status: "ready",
    calendarUrl: "https://calendar.google.com/calendar/u/0?cid=ZGVtby1jb21iaW5lZEBncm91cC5jYWxlbmRhci5nb29nbGUuY29t",
  },
  trigger: { count: 1, intervalMinutes: 15 },
  horizon: { pastDays: 60, futureMonths: 18 },
  health: {
    lastRun: "2026-09-02T08:15:00.000Z",
    lastSuccessfulRun: "2026-09-02T08:15:00.000Z",
    lastRunStatus: "ok",
    lastRunCounts: {
      sourcesConfigured: 4,
      sourcesSuccessful: 4,
      desired: 38,
      created: 2,
      updated: 1,
      deleted: 0,
      unchanged: 35,
      unmanagedTargetEvents: 0,
    },
  },
  calendars: [
    {
      id: "destination-combined",
      name: "CalendarShare – Combined",
      timeZone: "America/New_York",
      accessRole: "owner",
      primary: false,
      selected: false,
      hidden: false,
      missing: false,
      available: true,
      freeBusyOnly: false,
      isDestination: true,
      policy: "IGNORE",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
      busyLabel: "",
    },
    {
      id: "work-primary",
      name: "Work",
      timeZone: "America/New_York",
      accessRole: "owner",
      primary: true,
      selected: true,
      hidden: false,
      missing: false,
      available: true,
      freeBusyOnly: false,
      isDestination: false,
      policy: "FULL",
      copyDescription: true,
      copyLocation: true,
      allowPrivateDetails: false,
      busyLabel: "Busy (Work)",
    },
    {
      id: "personal-cal",
      name: "Personal",
      timeZone: "America/New_York",
      accessRole: "owner",
      primary: false,
      selected: true,
      hidden: false,
      missing: false,
      available: true,
      freeBusyOnly: false,
      isDestination: false,
      policy: "FULL",
      copyDescription: false,
      copyLocation: true,
      allowPrivateDetails: false,
      busyLabel: "Busy (Personal)",
    },
    {
      id: "course-schedule",
      name: "Course Schedule",
      timeZone: "America/New_York",
      accessRole: "reader",
      primary: false,
      selected: true,
      hidden: false,
      missing: false,
      available: true,
      freeBusyOnly: false,
      isDestination: false,
      policy: "BUSY_ONLY",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
      busyLabel: "Busy (Course Schedule)",
    },
    {
      id: "team-offsite",
      name: "Team Offsite",
      timeZone: "America/New_York",
      accessRole: "freeBusyReader",
      primary: false,
      selected: true,
      hidden: false,
      missing: false,
      available: true,
      freeBusyOnly: true,
      isDestination: false,
      policy: "BUSY_ONLY",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
      busyLabel: "Busy (Team Offsite)",
    },
    {
      id: "holidays-us",
      name: "Holidays in United States",
      timeZone: "America/New_York",
      accessRole: "reader",
      primary: false,
      selected: false,
      hidden: true,
      missing: false,
      available: true,
      freeBusyOnly: false,
      isDestination: false,
      policy: "IGNORE",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
      busyLabel: "",
    },
    {
      id: "archived-project",
      name: "Archived Project",
      timeZone: "America/New_York",
      accessRole: "reader",
      primary: false,
      selected: false,
      hidden: false,
      missing: true,
      available: false,
      freeBusyOnly: false,
      isDestination: false,
      policy: "IGNORE",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
      busyLabel: "",
    },
  ],
};

const DEMO_DRY_RUN = {
  status: "ok",
  generatedAt: "2026-09-02T08:15:00.000Z",
  sourceCount: 4,
  sources: [
    { sourceHash: "work-primary", status: "readable", accessRole: "owner", occurrenceCount: 21, recurringCount: 6, allDayCount: 1, privateCount: 0 },
    { sourceHash: "personal-cal", status: "readable", accessRole: "owner", occurrenceCount: 9, recurringCount: 2, allDayCount: 0, privateCount: 0 },
    { sourceHash: "course-schedule", status: "readable", accessRole: "reader", occurrenceCount: 6, recurringCount: 4, allDayCount: 0, privateCount: 0 },
    { sourceHash: "team-offsite", status: "readable", accessRole: "freeBusyReader", occurrenceCount: 2, recurringCount: 0, allDayCount: 0, privateCount: 0 },
  ],
};

const DEMO_SYNC = {
  status: "ok",
  counts: DEMO_STATE.health.lastRunCounts,
};

const SCREENSHOT_STYLE = `<style>
/* Hides the scrollbar in preview/screenshot captures only; not part of the production dashboard. */
html { scrollbar-width: none; -ms-overflow-style: none; }
html::-webkit-scrollbar { display: none; }
</style>
`;

const MOCK_SCRIPT = `<script>
window.google = (function () {
  var state = JSON.parse(${JSON.stringify(JSON.stringify(DEMO_STATE))});
  var dryRun = JSON.parse(${JSON.stringify(JSON.stringify(DEMO_DRY_RUN))});
  var sync = JSON.parse(${JSON.stringify(JSON.stringify(DEMO_SYNC))});
  var successHandler = null;
  var failureHandler = null;
  var handlers = {
    getDashboardState: function () { return state; },
    initializeDashboard: function () { return state; },
    saveDashboardConfig: function (input) {
      state.destination.name = (input && input.destinationName) || state.destination.name;
      if (input && input.horizon) state.horizon = input.horizon;
      return state;
    },
    runDashboardDryRun: function () { return dryRun; },
    runDashboardSync: function () { return sync; },
  };
  var run = {
    withSuccessHandler: function (fn) { successHandler = fn; return run; },
    withFailureHandler: function (fn) { failureHandler = fn; return run; },
  };
  Object.keys(handlers).forEach(function (name) {
    run[name] = function (args) {
      var fn = handlers[name];
      window.setTimeout(function () {
        try {
          var result = fn(args);
          if (successHandler) successHandler(result);
        } catch (error) {
          if (failureHandler) failureHandler(error);
        }
      }, 120);
    };
  });
  return { script: { run: run } };
})();
</script>
`;

async function buildPreviewHtml() {
  const html = await readFile(new URL("../src/ui/Index.html", import.meta.url), "utf8");
  const scriptTagIndex = html.indexOf("<script>");
  if (scriptTagIndex === -1) throw new Error("Could not find the dashboard's inline <script> tag");
  return html.slice(0, scriptTagIndex) + SCREENSHOT_STYLE + MOCK_SCRIPT + html.slice(scriptTagIndex);
}

async function main() {
  const previewHtml = await buildPreviewHtml();

  await mkdir(new URL("../dist/preview/", import.meta.url), { recursive: true });
  const outPath = new URL("../dist/preview/dashboard.html", import.meta.url);
  await writeFile(outPath, previewHtml, "utf8");

  const port = Number(process.env.PORT) || 4173;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(previewHtml);
  });
  server.listen(port, () => {
    console.log(`CalendarShare preview (synthetic data) running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop.");
  });
}

main();
