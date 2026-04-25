/**
 * The list of source adapters distill knows how to read.
 *
 * To add a new tool (Aider, Cursor, etc.), implement `SourceAdapter` in
 * `./<tool>.ts` and append it to the `ADAPTERS` array.
 */
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import type { SourceAdapter } from "./types.ts";

export const ADAPTERS: SourceAdapter[] = [claudeAdapter, codexAdapter];

export type { SourceAdapter } from "./types.ts";
