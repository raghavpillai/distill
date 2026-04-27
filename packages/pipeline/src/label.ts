/**
 * LLM-based one-sentence label per cluster. Uses AI SDK's generateObject for
 * strict schema-enforced output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generateObject } from "ai";
import { z } from "zod";
import { chatInfo, chatModel } from "./ai.ts";
import { DATA_DIR } from "./common.ts";
import type { Cluster } from "./types.ts";

const labelSchema = z.object({
  label: z
    .string()
    .describe(
      "A single concise label (≤10 words, lowercase, no trailing punctuation) describing the shared intent.",
    ),
});

const familyLabelSchema = z.object({
  label: z
    .string()
    .describe(
      "A short, descriptive 1-4 word name for the family (the theme these clusters share). Title Case. No punctuation.",
    ),
});

const SYSTEM =
  "You read short messages a developer sent to an AI coding assistant and describe " +
  "the common intent shared by the messages. Respond with a single concise label of at most 10 words. " +
  "No punctuation at the end. No quotes. Lowercase.";

const FAMILY_SYSTEM =
  "You pick a short, descriptive name for a group of related workflow clusters. " +
  "Given N cluster labels that share a theme, return a 1-4 word family name in Title Case " +
  "that captures what they have in common. No punctuation, no trailing 'workflow' or 'tasks' filler.";

function buildPrompt(c: Cluster): string {
  const kw = c.keywords.slice(0, 8).join(", ") || "(none)";
  const msgs = c.exemplars.map((e) => `- ${e.slice(0, 280)}`).join("\n");
  return `Here are ${c.exemplars.length} messages from one cluster. They share a common intent.
Top keywords: ${kw}

Messages:
${msgs}

Return the label.`;
}

async function main(): Promise<void> {
  const clusters = JSON.parse(readFileSync(`${DATA_DIR}clusters.json`, "utf8")) as Cluster[];
  const info = chatInfo();
  console.log(`labeling ${clusters.length} clusters via ${info.provider}:${info.model}`);

  const model = chatModel();
  for (const c of clusters) {
    const { object } = await generateObject({
      model,
      schema: labelSchema,
      system: SYSTEM,
      prompt: buildPrompt(c),
      temperature: 0,
    });
    let label = object.label.trim().split("\n")[0]!.trim();
    label = label.replace(/^["']+|["'.]+$/g, "").toLowerCase();
    if (label.length > 120) label = label.slice(0, 120);
    c.label = label || c.tfidf_label;
    console.log(`  #${String(c.id).padStart(3)} (${String(c.size).padStart(4)}): ${c.label}`);
  }

  // Pass 2: LLM-label each multi-member family. TF-IDF keyword intersection
  // produces word salad ("artifacts test / verifiable let"); gpt-5.4 can read
  // the actual cluster labels and name the theme in 1-4 words.
  const byFamily = new Map<number, Cluster[]>();
  for (const c of clusters) {
    const arr = byFamily.get(c.family_id) ?? [];
    arr.push(c);
    byFamily.set(c.family_id, arr);
  }
  const multiMember = [...byFamily.values()].filter((m) => m.length >= 2);
  if (multiMember.length > 0) {
    console.log(`labeling ${multiMember.length} multi-member families`);
    for (const members of multiMember) {
      const list = members
        .sort((a, b) => b.size - a.size)
        .map((c) => `- ${c.label || c.tfidf_label} (n=${c.size})`)
        .join("\n");
      try {
        const { object } = await generateObject({
          model,
          schema: familyLabelSchema,
          system: FAMILY_SYSTEM,
          prompt: `These ${members.length} clusters form one family. Pick a short family name that captures their shared theme.\n\n${list}\n\nReturn the family name.`,
          temperature: 0,
        });
        let label = object.label.trim().split("\n")[0]!.trim();
        label = label.replace(/^["']+|["'.]+$/g, "");
        if (label.length > 60) label = label.slice(0, 60);
        for (const m of members) m.family_label = label;
        console.log(`  family ${members[0]!.family_id}: "${label}"`);
      } catch (e) {
        console.warn(
          `  family ${members[0]!.family_id}: fallback to tf-idf — ${(e as Error).message}`,
        );
      }
    }
  }

  writeFileSync(`${DATA_DIR}clusters.json`, JSON.stringify(clusters));
  console.log(`updated ${DATA_DIR}clusters.json with llm labels`);
}

await main();
