/** REASONIX_DEBUG_MCP=1 surfaces dropped malformed lines on stderr; otherwise silent. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StdioTransport } from "../src/mcp/stdio.js";

const GARBAGE_THEN_EXIT = "process.stdout.write('not-json-banner\\n'); process.exit(0)";

describe("StdioTransport REASONIX_DEBUG_MCP", { timeout: 5_000 }, () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs the dropped line to stderr when REASONIX_DEBUG_MCP=1", async () => {
    vi.stubEnv("REASONIX_DEBUG_MCP", "1");
    const t = new StdioTransport({
      command: "node",
      args: ["-e", GARBAGE_THEN_EXIT],
      shell: false,
    });
    await new Promise((r) => setTimeout(r, 250));
    await t.close();

    const stderrCalls = writeSpy.mock.calls.map((c) => String(c[0]));
    expect(
      stderrCalls.some((s) => s.includes("[mcp-stdio] dropped malformed line: not-json-banner")),
    ).toBe(true);
  });

  it("stays silent when REASONIX_DEBUG_MCP is unset", async () => {
    vi.stubEnv("REASONIX_DEBUG_MCP", "");
    const t = new StdioTransport({
      command: "node",
      args: ["-e", GARBAGE_THEN_EXIT],
      shell: false,
    });
    await new Promise((r) => setTimeout(r, 250));
    await t.close();

    const stderrCalls = writeSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("[mcp-stdio] dropped malformed line"))).toBe(false);
  });

  it("stays silent when REASONIX_DEBUG_MCP is set to something other than '1'", async () => {
    vi.stubEnv("REASONIX_DEBUG_MCP", "true");
    const t = new StdioTransport({
      command: "node",
      args: ["-e", GARBAGE_THEN_EXIT],
      shell: false,
    });
    await new Promise((r) => setTimeout(r, 250));
    await t.close();

    const stderrCalls = writeSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("[mcp-stdio] dropped malformed line"))).toBe(false);
  });
});
