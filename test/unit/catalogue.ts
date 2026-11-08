import { RedditClient, type RedditConfig } from "../../src/client.js";
import { registerRedditReads, registerRedditWrites } from "../../src/tools.js";

export const ACCOUNT = "a2_qa";
export type Tool = { name: string; description: string; shape: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown>; write: boolean };

export function makeConfig(extra: Partial<RedditConfig> = {}): RedditConfig {
  return { accessToken: "TEST_TOKEN", allowedAccountIds: [ACCOUNT], userAgent: "node:reddit-ads-test:v0", jobSigningKey: "test-signing-key", ...extra };
}

/** Registers every tool on a plain collector, as the MCP server does, without a transport. */
export function collect(config: RedditConfig = makeConfig(), writes = true) {
  const api = new RedditClient(config);
  const tools: Tool[] = [];
  const collector = { tool(name: string, description: string, shape: any, handler: any) { tools.push({ name, description, shape, handler, write: Object.hasOwn(shape, "confirm") }); } };
  registerRedditReads(collector, api);
  if (writes) registerRedditWrites(collector, api);
  return { api, tools };
}

export async function call(tools: Tool[], name: string, args: Record<string, unknown> = {}) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  const scoped = Object.hasOwn(tool.shape, "adAccountId") ? { adAccountId: ACCOUNT } : {};
  const result = (await tool.handler({ ...scoped, ...args })) as { isError?: boolean; content: { text: string }[] };
  return { error: result.isError, text: result.content[0].text, data: JSON.parse(result.content[0].text) };
}
