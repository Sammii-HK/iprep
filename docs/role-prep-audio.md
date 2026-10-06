# Role prep audio

Every role you prep for gets a folder that links the role bank to the shared banks, plus audio for every bank in it.

## What the audio is

- One spoken episode per bank, stored in R2 at `audio/study/<bankId>.mp3`, with a transcript (`.txt`) and a source hash (`.json`).
- Read in a clear UK English coach voice (DeepInfra Kokoro, voice `bf_emma`). For each question you hear the question, a 4 second pause to answer out loud, then your answer notes.
- Question text and answer hints are read exactly as stored. Nothing is rewritten, summarised or added.
- Cost is roughly 0.05p per 1,000 characters. A 13 question bank is about 0.3 to 0.4p.
- The folder page "Play folder" button and the bank page player already read this key, so no database change is needed.

## New role in one step

1. Create the role bank (iPrep import, or the iPrep MCP `create_bank` tool). Note its id.
2. Run:

```bash
export PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"
cd ~/development/iprep
npx tsx scripts/new-role-folder.ts --title "Acme Interview Prep" --role-bank <roleBankId>
```

That creates the folder (or reuses one with the same title), links the role bank first and then the default shared banks (Design Systems x2, verified stories, stories addendum, real questions, interview communication), then generates audio for every bank in the folder that does not have it yet.

Options: `--shared <bankId>` to add more banks, `--no-default-shared`, `--no-audio` (folder only), `--dry-run`.

## Audio only

```bash
# See which banks have no audio (free, read only)
npx tsx scripts/generate-bank-episodes.ts --status
npx tsx scripts/generate-bank-episodes.ts --status --folder "Personio Interview Prep"

# Estimate, then generate, for a folder by title or id
npx tsx scripts/generate-bank-episodes.ts --folder "Acme Interview Prep" --dry-run
npx tsx scripts/generate-bank-episodes.ts --folder "Acme Interview Prep"

# Specific banks
npx tsx scripts/generate-bank-episodes.ts <bankId> <bankId>
```

Flags: `--max-gbp <n>` (default 1.00, aborts if the estimate is higher), `--voice`, `--pause <seconds>`, `--force`.

Safe to re-run: a bank is skipped when its stored source hash matches the current questions and hints. Edit a hint and the next run regenerates only that bank. An episode made by an older tool (no hash) is left alone unless you pass `--force`. Banks titled `OLD (superseded ...` and folders titled `Archive:` are never generated.

## Credentials

The script reads, without printing them:

- `IPREP_BASE_URL` and `IPREP_INTERNAL_KEY` from the environment, or from `~/.claude.json` under `mcpServers.iprep.env`.
- `DEEPINFRA_API_KEY` from `.env.local`.
- `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from `.env.production.local`.

It looks in the current directory and then `../iprep`. It needs `ffmpeg` on PATH (or `FFMPEG_PATH`).

## Listening

Open the folder in iPrep and press "Play folder". It plays every bank's audio back to back and keeps going with the screen locked (Safari on iPad and iPhone). Lock-screen controls give play, pause, next, previous and seek. Speed is the x button. It remembers where you stopped per folder on that device. Banks with no audio are listed under the player with the exact command to generate them.
