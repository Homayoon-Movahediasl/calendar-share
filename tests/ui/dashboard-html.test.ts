import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../src/ui/Index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

describe("dashboard HTML", () => {
  it("contains syntactically valid client JavaScript and all server actions", () => {
    expect(script).toBeTruthy();
    expect(() => new vm.Script(script!)).not.toThrow();
    for (const action of ["getDashboardState", "saveDashboardConfig", "runDashboardDryRun", "runDashboardSync"]) {
      expect(script).toContain(`'${action}'`);
    }
  });

  it("submits the editable destination calendar name", () => {
    expect(html).toContain('id="destinationNameInput"');
    expect(script).toContain("destinationName:$('destinationNameInput').value");
  });

  it("keeps source text out of HTML parsing and retains checkbox nodes", () => {
    expect(html).not.toContain(".innerHTML");
    expect(script).toContain("lab.appendChild(inp)");
    expect(script).toContain("text(span,item[1])");
  });

  it("omits ordinary ignored rows but sends tombstones for unavailable rows", () => {
    expect(script).toContain("if(p==='IGNORE'){if(!c.available)sources[c.id]={policy:'IGNORE'};return");
  });

  it("provides responsive filtering, setup, and safe action states", () => {
    expect(html).toContain('id="sourceSearch"');
    expect(html).toContain('data-filter="unavailable"');
    expect(html).toContain('id="setupView"');
    expect(script).toContain("initializeDashboard");
    expect(script).toContain("dirty");
    expect(html).toContain("prefers-reduced-motion");
  });
});
