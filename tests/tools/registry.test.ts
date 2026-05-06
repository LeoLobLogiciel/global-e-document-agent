import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createRegistry } from "../../src/tools/registry.js";

const echoTool = {
  name: "echo",
  description: "Echoes the input",
  argsSchema: z.object({ message: z.string() }),
  execute: async (args: unknown) => (args as { message: string }).message,
};

const failingTool = {
  name: "fail",
  description: "Always throws",
  argsSchema: z.object({}),
  execute: async () => {
    throw new Error("boom");
  },
};

describe("createRegistry / dispatch", () => {
  it("returns error for unknown tool", async () => {
    const { dispatch } = createRegistry([echoTool]);
    const result = await dispatch("nonexistent", {});
    expect(result).toContain("Unknown tool");
    expect(result).toContain("nonexistent");
    expect(result).toContain("echo");
  });

  it("returns error for invalid args", async () => {
    const { dispatch } = createRegistry([echoTool]);
    const result = await dispatch("echo", { message: 42 });
    expect(result).toContain("Invalid arguments");
  });

  it("dispatches successfully and returns result", async () => {
    const { dispatch } = createRegistry([echoTool]);
    const result = await dispatch("echo", { message: "hello" });
    expect(result).toBe("hello");
  });

  it("catches execute errors and returns error string", async () => {
    const { dispatch } = createRegistry([failingTool]);
    const result = await dispatch("fail", {});
    expect(result).toContain("boom");
  });

  it("exposes tools list", () => {
    const { tools } = createRegistry([echoTool, failingTool]);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toContain("echo");
  });
});
