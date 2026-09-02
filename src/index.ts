import {
  doGet,
  getDashboardState,
  healthCheck,
  initializeDashboard,
  listCandidateCalendars,
  phase0DryRun,
  runDashboardDryRun,
  runDashboardSync,
  saveDashboardConfig,
  setup,
  syncCombinedCalendar,
} from "./app/runtime";

// Exported for the build wrapper and local type checking. The generated Apps
// Script file adds named top-level functions that delegate to these exports.
export {
  setup,
  listCandidateCalendars,
  phase0DryRun,
  syncCombinedCalendar,
  healthCheck,
  initializeDashboard,
  doGet,
  getDashboardState,
  saveDashboardConfig,
  runDashboardDryRun,
  runDashboardSync,
};
