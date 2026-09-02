import { describe, expect, it } from "vitest";
// The installer is deliberately plain Node ESM so it can run before TypeScript is built.
// @ts-expect-error JavaScript CLI module has no runtime type dependency.
import { deploy, parseDeployment, parseDeployments, readLocalState, writeLocalState } from "../../scripts/google-deploy.mjs";

describe("google deployment packaging", () => {
  it("parses JSON and human-readable clasp deployment output", () => {
    expect(parseDeployment('{"deploymentId":"AKfycb_demo","url":"https://script.google.com/macros/s/AKfycb_demo/exec"}')).toEqual({
      deploymentId: "AKfycb_demo",
      url: "https://script.google.com/macros/s/AKfycb_demo/exec",
    });
    expect(parseDeployment("Created deployment AKfycb_demo\nhttps://script.google.com/macros/s/AKfycb_demo/exec").deploymentId).toBe("AKfycb_demo");
  });

  it("discovers selectable deployments without making network calls", () => {
    expect(parseDeployments("@1 - CalendarShare production (AKfycb_one)\n@2 - Staging (AKfycb_two)")).toHaveLength(2);
  });

  it("reads and writes local state through an injectable filesystem", () => {
    const files: Record<string, string> = {};
    const fs = {
      existsSync: (file: string) => file in files,
      readFileSync: (file: string) => files[file],
      writeFileSync: (file: string, value: string) => { files[file] = value; },
    };
    writeLocalState({ deploymentId: "AKfycb_demo" }, "state.json", fs);
    expect(readLocalState("state.json", fs)).toEqual({ deploymentId: "AKfycb_demo" });
  });

  it("completes a fresh install even when clasp's deploy output has no URL", async () => {
    const files: Record<string, string> = {};
    const calls: string[] = [];
    const fs = {
      existsSync: (file: string) => file in files,
      readFileSync: (file: string) => files[file],
      writeFileSync: (file: string, value: string) => { files[file] = value; },
    };
    const runner = (file: string, args: string[]) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (args.includes("deploy")) return "Created version 3.\nCreated deployment AKfycb_freshexample.";
      return "authorized";
    };
    const saved = await deploy({ runner, fs });
    expect(calls).toContain("npx clasp create --type standalone --title CalendarShare --rootDir dist");
    expect(saved.deploymentId).toBe("AKfycb_freshexample");
    expect(saved.url).toBe("https://script.google.com/macros/s/AKfycb_freshexample/exec");
  });

  it("updates the existing deployment instead of creating another one", async () => {
    const files: Record<string, string> = { ".clasp.json": "{}", ".calendarshare.local.json": JSON.stringify({ deploymentId: "AKfycb_existing" }) };
    const calls: string[] = [];
    const fs = {
      existsSync: (file: string) => file in files,
      readFileSync: (file: string) => files[file],
      writeFileSync: (file: string, value: string) => { files[file] = value; },
    };
    const runner = (file: string, args: string[]) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (args.includes("update-deployment")) return "Updated deployment AKfycb_existing";
      return "authorized";
    };
    await deploy({ runner, fs });
    expect(calls).toContain("npx clasp update-deployment AKfycb_existing --description CalendarShare production");
    expect(calls.some((call) => call.includes("create-deployment") || call.includes(" deploy "))).toBe(false);
    expect(JSON.parse(files[".calendarshare.local.json"]).url).toContain("AKfycb_existing");
  });
});
