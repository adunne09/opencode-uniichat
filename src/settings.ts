import { CHAT_BUDGET, COMPACTION_BUDGET, type Budget } from "./view.ts";
export interface EngineSettings {
  concurrency: number;
  /** An import's leaves summarized at once (its merges run `concurrency` at once, as the chat's). */
  importLeaves: number;
  tries: number;
  timeoutMs: number;
  chat: Budget;
  compaction: Budget;
}
export const DEFAULT_ENGINE: Readonly<EngineSettings> = Object.freeze({
  concurrency: 64, importLeaves: 64, tries: 5, timeoutMs: 240000, chat: CHAT_BUDGET, compaction: COMPACTION_BUDGET,
});
