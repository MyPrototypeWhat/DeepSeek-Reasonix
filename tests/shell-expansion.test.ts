import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ConfirmationChoice, PauseGate } from "../src/core/pause-gate.js";
import { ToolRegistry } from "../src/tools.js";
import {
  detectUnsupportedExpansion,
  expandTilde,
  prepareSpawn,
  registerShellTools,
} from "../src/tools/shell.js";

/** Records the gate call and denies — lets us assert whether the gate was reached at all. */
class SpyGate extends PauseGate {
  lastCall: Parameters<PauseGate["ask"]>[0] | null = null;
  override ask = ((opts: Parameters<PauseGate["ask"]>[0]) => {
    this.lastCall = opts;
    return Promise.resolve({ type: "deny" } as ConfirmationChoice);
  }) as PauseGate["ask"];
}

// Issue #2105 — detect shell expansion the no-shell executor can't perform.
describe("detectUnsupportedExpansion", () => {
  it("flags an unquoted env var", () => {
    expect(detectUnsupportedExpansion("ls $PROJECT_DIR/src")).toEqual({
      kind: "env",
      sample: "$PROJECT_DIR",
    });
  });

  it("flags ${BRACED} env vars and reports the braced sample", () => {
    expect(detectUnsupportedExpansion("cat ${HOME}/.config")).toEqual({
      kind: "env",
      sample: "${HOME}",
    });
  });

  it("flags command substitution — both $(…) and backticks", () => {
    expect(detectUnsupportedExpansion("echo $(date)")).toEqual({ kind: "cmdsub", sample: "$(…)" });
    expect(detectUnsupportedExpansion("echo `date`")).toEqual({ kind: "cmdsub", sample: "`…`" });
  });

  it("flags a bare glob", () => {
    expect(detectUnsupportedExpansion("ls *.ts")).toEqual({ kind: "glob", sample: "*" });
  });

  it("flags $VAR even inside double quotes (a shell would expand it there)", () => {
    expect(detectUnsupportedExpansion('echo "$HOME"')).toEqual({ kind: "env", sample: "$HOME" });
  });

  it("does NOT flag single-quoted spans (fully literal)", () => {
    expect(detectUnsupportedExpansion("grep '$foo' file")).toBeNull();
    expect(detectUnsupportedExpansion("awk '{print $1}' f")).toBeNull();
    expect(detectUnsupportedExpansion("find . -name '*.ts'")).toBeNull();
  });

  it("does NOT flag a glob inside double quotes (literal there)", () => {
    expect(detectUnsupportedExpansion('find . -name "*.ts"')).toBeNull();
  });

  it("does NOT flag a leading ~ (prepareSpawn expands it at exec)", () => {
    expect(detectUnsupportedExpansion("cat ~/notes.txt")).toBeNull();
  });

  it("does NOT flag a lone $ or a `?` in a URL (avoids false positives)", () => {
    expect(detectUnsupportedExpansion("echo costs 5$")).toBeNull();
    expect(detectUnsupportedExpansion("curl http://x/y?z=1")).toBeNull();
  });

  it("returns null for ordinary allowlisted commands and chains/redirects", () => {
    expect(detectUnsupportedExpansion("git status")).toBeNull();
    expect(detectUnsupportedExpansion("grep -c TODO src | wc -l")).toBeNull();
    expect(detectUnsupportedExpansion("npm test > out.log 2>&1")).toBeNull();
  });
});

// Issue #2105 — a leading ~ is expanded at exec via prepareSpawn.
describe("expandTilde / prepareSpawn ~ expansion", () => {
  it("expandTilde resolves ~ and ~/… but leaves ~user and mid-token ~ alone", () => {
    expect(expandTilde("~")).toBe(homedir());
    expect(expandTilde("~/notes.txt")).toBe(join(homedir(), "notes.txt"));
    expect(expandTilde("~bob/x")).toBe("~bob/x");
    expect(expandTilde("a~b")).toBe("a~b");
  });

  it("prepareSpawn expands a leading ~ in arguments", () => {
    const out = prepareSpawn(["cat", "~/notes.txt"], { platform: "linux" });
    expect(out.bin).toBe("cat");
    expect(out.args).toEqual([join(homedir(), "notes.txt")]);
  });

  it("prepareSpawn expands ~ in the executable position too", () => {
    const out = prepareSpawn(["~/bin/tool", "arg"], { platform: "linux" });
    expect(out.bin).toBe(join(homedir(), "bin/tool"));
    expect(out.args).toEqual(["arg"]);
  });

  it("prepareSpawn leaves non-~ argv untouched", () => {
    const out = prepareSpawn(["npm", "install"], { platform: "linux" });
    expect(out.bin).toBe("npm");
    expect(out.args).toEqual(["install"]);
  });
});

describe("run_command — unsupported expansion gate (issue #2105)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "reasonix-exp-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("errors on $VAR before consulting the confirmation gate", async () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp });
    const spy = new SpyGate();
    const out = await registry.dispatch(
      "run_command",
      JSON.stringify({ command: "ls $PROJECT_DIR/src" }),
      { confirmationGate: spy },
    );
    expect(out).toMatch(/without a shell/i);
    expect(out).toContain("$PROJECT_DIR");
    // Short-circuited before the gate — no pointless confirmation prompt.
    expect(spy.lastCall).toBeNull();
  });

  it("errors on a bare glob even in allowAll mode", async () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp, allowAll: true });
    const out = await registry.dispatch("run_command", JSON.stringify({ command: "ls *.ts" }));
    expect(out).toMatch(/without a shell/i);
    expect(out).toMatch(/glob/i);
  });
});
