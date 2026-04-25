# distill

Workflows you repeat, crystallized into Claude Code skills.

`distill` reads your Claude Code conversation history, finds the things you ask
for over and over, and proposes [Claude Code skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
for the patterns worth making reusable. It ships an observatory-style 3D
interface so you can see those patterns as a galaxy: every prompt is a planet,
every recurring workflow a solar system.

It is a one-shot indexer meant to be run against your own history, locally,
with local models. No prompts leave your machine.

---

## What it does

1. **Indexes.** Walks `~/.claude/projects/*.jsonl`, pulls out every user prompt
   across every repo you've worked in.
2. **Embeds.** Encodes each prompt with a local embedding model.
3. **Clusters.** UMAP → HDBSCAN → centroid-similarity merge. Similar prompts
   form clusters; related clusters form "families".
4. **Judges.** A local LLM reads each cluster's exemplars (±2-turn snippets for
   context) and decides whether the pattern is worth a skill — and if so,
   drafts one.
5. **De-duplicates.** Embeds every SKILL.md already installed in
   `~/.claude/skills/*/SKILL.md` and suppresses proposals that overlap.
6. **Renders.** A 3D galaxy view where clusters are suns, prompts are planets
   orbiting them, and families of related clusters sit near one another.

## Screens

- A scatter of every prompt, colored by cluster.
- Click a sun: the camera flies to the cluster. Planets are individually
  clickable and open the full conversation transcript at that turn.
- A side panel of proposed skills, sorted by frequency, each with a workflow
  summary and provenance (which prompts it was distilled from).

## Running it

```bash
# 1. Install deps
bun install

# 2. Make sure Ollama is running with the defaults distill expects
ollama pull qwen3-embedding:8b
ollama pull qwen2.5:14b-instruct

# 3. Run the indexing pipeline once (~15–30 min depending on history size)
bun run pipeline

# 4. Open the observatory
bun run dev
# → http://localhost:5319
```

Prefer a hosted model? Set provider env vars before the pipeline step:

```bash
CCC_CHAT_PROVIDER=anthropic  ANTHROPIC_API_KEY=... \
CCC_EMBED_PROVIDER=openai    OPENAI_API_KEY=...  \
  bun run pipeline
```

(Anthropic has no embeddings endpoint; embed provider falls back to Ollama if
you leave it unset.)

## Layout

```
apps/web/            # Vite + React + react-three-fiber galaxy UI
packages/pipeline/   # TypeScript indexing pipeline (ingest → embed → cluster → judge)
```

The pipeline writes intermediate artifacts into `packages/pipeline/data/` and
a single `web.json` that the UI reads.

## Why

Skills work best when they're grounded in what you actually do, not what
someone thinks you should do. The loop is: your own history → embeddings →
clusters → drafts → the ones you accept become installed skills that shape
future sessions.

## Stack

- Bun + Turborepo
- Vercel AI SDK (`ai`, `ollama-ai-provider-v2`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- UMAP (`umap-js`) + HDBSCAN (`hdbscan-ts`)
- React 19, Tailwind 4, `@react-three/fiber` + `drei` + `postprocessing`, `motion/react`, `streamdown`

## Status

One-time demo. Not a product. Rerunning the pipeline is idempotent; the UI is
static once the data file is written.
