/**
 * Tool-agnostic filters for deciding whether a user prompt is "substantive"
 * (worth clustering) vs filler (confirmations, follow-ups, raw tool output).
 *
 * Both Claude Code and Codex CLI feed user-typed messages through this.
 * Adapter-specific harness boilerplate (e.g. Claude Code's `<command-name>`
 * tag, Codex's `<environment_context>` block) is detected by the adapters
 * themselves before they call into here.
 */
import { stripSystemTags } from "../common.ts";

const MIN_SUBSTANTIVE_CHARS = 30;

const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(yes|yeah|yep|yup|yup\.|ok|okay|k+|sure|go|continue|proceed|cool|nice|thanks?|thank you|ty|great|perfect|good|done|right|correct|exactly|fine|works|ship it|kk|mhm|hmm+|oh|ah|hm)\b[\s.,!?👍🎉✅]*$/i,
  /^(go|just)\s+(ahead|for it|on|do it|keep going)[\s.,!?]*$/i,
  /^let'?s (go|do it|continue|try( that)?)[\s.,!?]*$/i,
  /^(that'?s )?(great|perfect|amazing|awesome|good|fine|correct|it|right|all good)[\s.,!?]*$/i,
  /^(sounds|looks)\s+(good|great|fine|right|correct)[\s.,!?]*$/i,
  /^(do|try|run|check|fix|keep going|restart|retry|continue|proceed|ship|test|push)[\s.,!?]*$/i,
  /^(what|why|how)\?[\s.,!?]*$/i,
  /^no[\s.,!?]*$/i,
  /^(makes? sense|got it|understood|i see|interesting)[\s.,!?]*$/i,
];

// Prompts that lean heavily on prior conversation context. Flag if short AND
// starts with a referential lead like "now", "also", "fix it", "do that".
const FOLLOWUP_LEADS =
  /^(now|also|then|and|but|fix|continue|keep|do|try|make|check|also,?)\b[^a-z0-9]*(it|that|this|those|them|there|again|once more)?\b/i;

function stripForAnalysis(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSubstantiveTaskPrompt(text: string, isSlash: boolean): boolean {
  if (isSlash) return false;
  // Strip system-injected tags first so a prompt that is *entirely* harness
  // exhaust (e.g. a `<local-command-stdout>` blob from a shell alias) doesn't
  // pass the substantive-length check on its boilerplate alone.
  const noTags = stripSystemTags(text);
  if (!noTags) return false;
  const stripped = stripForAnalysis(noTags);
  if (stripped.length < MIN_SUBSTANTIVE_CHARS) return false;
  if (CONFIRMATION_PATTERNS.some((rx) => rx.test(stripped))) return false;
  // Very short follow-ups that are referential filler.
  if (stripped.length < 60 && FOLLOWUP_LEADS.test(stripped)) {
    const afterLead = stripped.replace(FOLLOWUP_LEADS, "").trim();
    if (afterLead.length < 25) return false;
  }
  return true;
}
