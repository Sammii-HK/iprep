# Interviews and Notion

iPrep shows your next interview on the dashboard, with a countdown, the joining link and a one-tap route into the prep audio for that company. This document explains how interviews get into iPrep, for you and for anyone else who uses it.

Nothing here is Notion-only. The in-app tracker is the default and works for everyone. Notion is an optional way to fill it.

## Options at a glance

| Path | Who it is for | Status |
| --- | --- | --- |
| In-app tracker | Everyone | Built (`/interviews`) |
| Notion sync with your own token | The owner, running a script on their own machine | Built (`scripts/sync-notion-interviews.py`) |
| Duplicable Notion template | Anyone who already lives in Notion | Contract defined below, template to publish |
| Notion public integration (OAuth) | Anyone, without running a script | Designed below, not built |
| Calendar import | Anyone who books interviews by invite | Later |

## (a) In-app tracker (default)

Open **Interviews** in the navigation, fill in company, role, round, date and time, and optionally the joining link, interviewer and prep folder. Leave the folder on "Match automatically" and iPrep will use any folder whose title contains the company name followed by "Interview Prep" (for example "Attio Interview Prep").

The dashboard card shows the soonest scheduled interview that has not finished. An interview stays "current" for an hour after it starts, or until its end time if you set one.

## (b) Duplicable Notion template

Publish a Notion database called **Interview Prep** with exactly the properties below. Anyone can duplicate it, share it with their own integration and point the sync at it.

### Property-name contract

Names are case-sensitive and must match exactly.

| Property | Type | Required | Used for |
| --- | --- | --- | --- |
| Title | Title | Yes | Fallback role name |
| Company | Rich text | Yes | Company, and prep folder matching |
| Role | Rich text | Yes (falls back to Title) | Role |
| Interview Date | Date, with time and time zone | Yes | Start (and end, if a range is set) |
| Interview Round | Select | No | Round |
| Interview Link | URL | No | Join button (http or https only) |
| Booking Link | URL | No | Rescheduling link |
| Interviewer | Rich text | No | Interviewer |
| Status | Select: Not started, In progress, Prepped, Scheduled | No | Not synced, for your own tracking |
| Linked Application | Relation | No | Not synced |

Rules the sync applies:

- A row needs a Company and an Interview Date to be sent.
- Rows more than a day in the past are ignored.
- A date with no time is treated as 09:00 in the row's time zone (UTC if none).
- Each Notion page id becomes the interview's `externalId`, so editing a row updates the same interview and never duplicates it.
- Each sync sends `complete: true`. A scheduled future interview that has disappeared from Notion is marked **cancelled** in iPrep (never deleted). If the row comes back it is rescheduled.
- A folder is only linked when one matches, and a sync never clears a folder you chose by hand.

## Running the owner's sync (Mac mini)

The script uses only the Python standard library.

```
export NOTION_TOKEN=...          # the Notion integration secret
export IPREP_BASE_URL=https://your-iprep-host
export IPREP_INTERNAL_KEY=...    # same value as IPREP_INTERNAL_KEY on the server

python3 scripts/sync-notion-interviews.py --dry-run   # prints the payload, sends nothing
python3 scripts/sync-notion-interviews.py             # syncs
```

The key authenticates through the existing `x-internal-key` mechanism, so interviews are created for the same account the MCP server uses.

### Sharing the database with your integration

A Notion integration can only read pages that have been shared with it. If you see `Notion returned 404 for the 'Interview Prep' database`, the integration cannot see it:

1. Open the **Interview Prep** database in Notion.
2. Click the `...` menu at the top right, then **Connections**.
3. Add the integration whose token is in `NOTION_TOKEN`.
4. Run the script again.

If the Cast job system's integration cannot read the database, either share it as above or create a dedicated integration for iPrep and use its token.

To run it regularly, schedule it with launchd or cron every 15 to 30 minutes.

## (c) Notion public integration (OAuth), per-user sync

This is what lets any user connect their own workspace without running a script. Not built yet.

### Flow

1. The user chooses **Connect Notion** in iPrep settings.
2. iPrep redirects to Notion's authorisation URL with a random `state` bound to the session.
3. The user picks the pages or databases to share. They should pick their Interview Prep database (or the page holding it).
4. Notion redirects back with a `code`. iPrep checks `state`, exchanges the code for an access token (server side, using the client secret) and stores it for that user only.
5. iPrep lists the databases the user shared, and the user picks one. iPrep checks that the property names match the contract above and reports any that are missing.
6. A per-user sync reads that database and upserts into that user's `Interview` rows with `source = 'notion'`, using the same `planSync` logic as the script.

### Scopes and capabilities

Request the minimum: **read content** only. iPrep never writes to Notion. No user information capability is needed beyond what the OAuth flow returns, and no comment or insert capabilities.

### Token storage

- Store the token in a new `NotionConnection` table: `userId` (unique), `workspaceId`, `workspaceName`, `databaseId`, `encryptedAccessToken`, `connectedAt`, `lastSyncedAt`, `lastError`.
- Encrypt the token at rest with AES-256-GCM, with a random nonce per value and the key held in an environment variable (`NOTION_TOKEN_ENCRYPTION_KEY`), never in the database. Support key rotation by storing a key version next to the ciphertext.
- Never log tokens, never return them from any API, never send them to the client.
- Disconnecting deletes the row. Deleting an iPrep account cascades to it.

### Per-user sync

- Triggered when the user opens the interviews page (rate limited, at most once every few minutes) and by a scheduled job that visits connections that have been active recently.
- Every query is scoped by `userId`. One user's token can only ever write to that user's rows.
- A 401 or 404 from Notion marks the connection as needing attention, shows the user a "reconnect" prompt and stops retrying.
- Notion rate limits (about three requests a second) are respected with backoff.

### Whose data it is

The interview data belongs to the user. iPrep reads only the database the user picked, stores only the fields in the contract, and does not use them for anything except showing the user their own schedule. Disconnecting stops the sync immediately. A "delete synced interviews" option removes the rows with `source = 'notion'`.

## (d) Calendar (later)

An optional import from a calendar (ICS feed URL or Google Calendar read-only) would map events to the same `Interview` rows with `source = 'calendar'` and the event id as `externalId`. It would need a rule for which events count as interviews (a calendar the user nominates, or a keyword), and it should reuse `planSync`.

## Checklist for Notion's public integration review

- [ ] Integration set to **public**, with a company name, website, privacy policy URL and terms URL on the integration page.
- [ ] Redirect URI registered exactly, on HTTPS only.
- [ ] Capabilities limited to **Read content**, with a plain explanation of why each is needed.
- [ ] OAuth `state` validated on callback, and codes exchanged server side only.
- [ ] Client secret held in server environment variables only.
- [ ] Access tokens encrypted at rest and never logged or exposed to the browser.
- [ ] A visible **Disconnect** control that deletes the stored token.
- [ ] Clear copy before connecting: what is read, what is stored, what is never done.
- [ ] Privacy policy states what Notion data is stored, how long, and how to delete it.
- [ ] Handles revoked access (401) and unshared databases (404) with a helpful message.
- [ ] Respects Notion rate limits.
- [ ] A published template for the property contract, so the integration has something sensible to connect to.
- [ ] A test workspace and demo video for the reviewers.
- [ ] Support contact email.

## API reference

All routes need a signed-in user, except `/api/interviews/sync`, which also accepts the `x-internal-key` header.

| Route | Purpose |
| --- | --- |
| `GET /api/interviews` | Upcoming first. Add `?includePast=true` for past and cancelled. |
| `POST /api/interviews` | Create a manual interview. |
| `PATCH /api/interviews/[id]` | Edit, change status (`scheduled`, `completed`, `cancelled`) or folder. |
| `DELETE /api/interviews/[id]` | Delete. |
| `POST /api/interviews/sync` | Machine upsert keyed by `externalId`. Body: `{ source: "notion", complete: boolean, interviews: [...] }`. |
| `GET /api/interviews/next` | The next interview plus its prep folder and banks. |
