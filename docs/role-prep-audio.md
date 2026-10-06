# Role prep audio

Every role you prep for gets a folder that links the role bank to the shared banks, plus audio for every bank in it.

## What the audio is

- One episode per bank, stored in R2 at `audio/study/<bankId>.mp3`, with a transcript (`.txt`) and a source hash (`.json`).
- **Default style: dialogue.** Two hosts, Jess and Zac, scripted by the Podify pipeline (`deep_review`, casual) and voiced by Orpheus (`canopylabs/orpheus-3b-0.1-ft` on DeepInfra). About 10 minutes and roughly 6p per bank.
- **Narrator style** (`--style narrator`): one UK English coach voice (Kokoro), questions and hints read exactly as stored, about 0.3p per bank.
- Source rules are prepended to the notes: only facts in the notes, no invented figures, dates, employers or outcomes, no em dashes, UK English, hosts are Jess and Zac only.
- The folder page "Play folder" button and the bank page player read the R2 key, so no database change is needed.

### Local first, upload only on request

Everything is written to `--out` (default `~/Desktop/podcast-preview`) as `<title>-<bankId>.mp3`, `.transcript.txt`, `.source-notes.txt` and a `.json` hash. Nothing goes to R2 unless you pass `--upload`.

Listen first, then re-run the same command with `--upload`. It uploads the local render without regenerating or paying again.

### Checks on every dialogue episode

A bank that fails is marked NEEDS REVIEW (a `.NEEDS-REVIEW.txt` file is written next to the audio), is never uploaded, and the run exits with code 2.

1. The transcript must not contain the host names Luna or Sol, or Lunary or The Grimoire branding (unless the notes themselves use the word).
2. Every number in the transcript must appear in the source notes. Any that do not are printed.

Fix the notes or re-run with `--force` to try again. Spelled-out numbers ("fourteen") are not checked, so still listen once.

## New role in one step

1. Create the role bank (iPrep import, or the iPrep MCP `create_bank` tool). Note its id.
2. Run:

```bash
export PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"
cd ~/development/iprep
npx tsx scripts/new-role-folder.ts --title "Acme Interview Prep" --role-bank <roleBankId>
```

That creates the folder (or reuses one with the same title), links the role bank first and then the default shared banks (Design Systems x2, verified stories, stories addendum, real questions, interview communication), then generates Jess and Zac dialogue episodes locally for every bank in it that does not have audio. Listen, then add `--upload` to publish.

Options: `--shared <bankId>`, `--no-default-shared`, `--no-audio` (folder only), `--style narrator`, `--upload`, `--out <dir>`, `--dry-run`.

## Audio only

```bash
# See which banks have no audio, and what filling the gaps would cost (free, read only)
npx tsx scripts/generate-bank-episodes.ts --status
npx tsx scripts/generate-bank-episodes.ts --status --folder "Personio Interview Prep"

# Estimate, generate locally, listen, then publish
npx tsx scripts/generate-bank-episodes.ts --folder "Acme Interview Prep" --dry-run
npx tsx scripts/generate-bank-episodes.ts --folder "Acme Interview Prep"
npx tsx scripts/generate-bank-episodes.ts --folder "Acme Interview Prep" --upload

# Specific banks
npx tsx scripts/generate-bank-episodes.ts <bankId> <bankId>
```

Flags: `--max-gbp <n>` (default 1.00, aborts if the estimate is higher; raise it for a whole folder), `--duration 10min`, `--style`, `--out`, `--upload`, `--force`, and for narrator `--voice` and `--pause`.

Cost model for dialogue: Orpheus at $7.00 per 1M characters on about 6 characters per word and 150 words per minute (10 minutes is 9,000 characters), plus a small allowance for the script model.

Safe to re-run: the hash covers style, voices, length, notes and rules, so a bank is skipped when nothing changed, and changing a hint regenerates only that bank. An existing episode with no hash (made by an older tool) is left alone unless you pass `--force`. Banks titled `OLD (superseded ...` and folders titled `Archive:` are never generated.

## Credentials

The script reads, without printing them:

- `IPREP_BASE_URL` and `IPREP_INTERNAL_KEY` from the environment, or from `~/.claude.json` under `mcpServers.iprep.env`.
- `DEEPINFRA_API_KEY` from `.env.local` (also used by Podify, which must exist at `~/development/podify` or `PODIFY_DIR`, with `pnpm` on PATH).
- `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from `.env.production.local`.

It looks in the current directory and then `../iprep`. Narrator style also needs `ffmpeg` on PATH (or `FFMPEG_PATH`).

## Listening

Open the folder in iPrep and press "Play folder". It plays every bank's audio back to back and keeps going with the screen locked (Safari on iPad and iPhone). Lock-screen controls give play, pause, next, previous and seek. Speed is the x button. It remembers where you stopped per folder on that device. Banks with no audio are listed under the player with the exact command to generate them.
