import { z } from "zod";

export type Tool = {
  name: string;
  description: string;
  argsSchema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<string>;
};

export function createRegistry(tools: Tool[]) {
  const map = new Map(tools.map((t) => [t.name, t]));

  async function dispatch(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const tool = map.get(name);
    if (!tool) {
      const available = [...map.keys()].join(", ");
      return `Unknown tool: "${name}". Available tools: ${available}`;
    }

    const parsed = tool.argsSchema.safeParse(args);
    if (!parsed.success) {
      return `Invalid arguments for tool "${name}": ${parsed.error.message}`;
    }

    try {
      return await tool.execute(parsed.data);
    } catch (err) {
      return `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { tools: [...map.values()], dispatch };
}

export type Registry = ReturnType<typeof createRegistry>;
