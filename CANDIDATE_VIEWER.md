# National score viewers

The `/candidates/` page reads 2026 ballot-verified candidate profiles from
PostgreSQL. The `/lawmakers/` page reads the 119th-Congress national v4 fit
from the same database. Scores and source text stay in PostgreSQL; this
repository contains only the presentation and a small read-only API.
The current verified roster covers California, Maryland, and Michigan.

The API in `server.py` serves:

- `GET /api/health` — checks that the database-backed API is reachable
- `GET /api/candidates` — roster, score status, and site-scale overall position
- `GET /api/candidates/<candidate_id>` — issue positions and source links
- `GET /api/lawmakers` — 551 joint-fit members plus Bernie Sanders and Angus King from the archived Senate-only refit, mapped approximately onto the selected fit's display scale
- `GET /api/lawmakers/<member_id>` — overall, 14 policy-area, and 54 detailed issue positions

It reads `mart.us_candidate_scorecard_2026`,
fit-keyed `mart.us_candidate_v4_calibrations`, and
`mart.us_candidate_issue_score_2026`, along with the versioned
`mart.us_national_v4_fits` and `mart.us_national_v4_member_scores`. The
scoring code and view definitions live
in the PoliticsApp repository under `analytics/`.

The API selects the newest fully loaded national fit with a complete candidate
calibration, including the October 2026 tweet refresh. The lawmaker and
candidate point endpoints select the same fit. When the newest fit does not
include the independent Senate refit or the exploratory candidate ranges, the
API takes them from the latest complete fit containing those supplemental rows
and maps their display points to the selected fit using shared lawmakers'
overall scores. The mapping is approximate and is labeled in the viewer. The API includes
`fit_status` so a diagnostic score can be identified explicitly. Each
calibration is also available by fit hash in
`mart.us_candidate_v4_calibrations`; rows without enough evidence keep a null
overall position.

As of 19 October 2026, all 109 ballot-verified candidates have issue cells and
93 have an overall position on the site's −50 to +50 display scale: 23 inherit
their linked lawmaker's exact v4 score, 14 have calibrated public-statement
estimates, and 56 have provisional estimates from cited issue positions. The
remaining 16 have no cited issue position and no individual overall number.
The provisional estimates use sparse evidence (one to eight issue signals)
and are labeled as such in the viewer. They have not passed an independent
candidate-like validation check. Older exploratory ranges from
`mart.us_candidate_v4_statement_bridge_preview` remain available as research
context but do not replace a point estimate.

For local review, install `requirements.txt`, set `DATABASE_URL` to a PostgreSQL URL or set
`POLITICSAPP_ENV_FILE` to a local `.env` file containing it, then run
`python server.py --port 8767` and open `http://127.0.0.1:8767/candidates/`.
Use a database account with SELECT-only privileges for a hosted deployment.
On a hosted server, pass `--host 0.0.0.0` and put it behind HTTPS and a proxy
for `/api/` and `/candidates/`.

The lawmakers page now searches the 109 ballot-verified candidates alongside
lawmakers and links to candidate profiles. Independent senators are stored in
`mart.us_national_v4_senate_independent_scores`, separately from the joint fit;
their cards and profiles label the separate Senate refit as provisional.

The viewer includes a Cloudflare Worker API in `src/index.js` and keeps the
candidate and lawmaker records in PostgreSQL. `npm run build` copies only
public site assets into `dist/`; the database API runs at the same origin and
does not bundle score data. Deploy it as a Cloudflare Worker with static assets
and a Hyperdrive binding named `CANDIDATE_DB`. The binding must use a PostgreSQL
login with `SELECT` access only to the tables listed above; each request also
opens an explicit `READ ONLY` transaction. Never use the application's
write-capable `SpurnaDB1` credential for this public endpoint.

The separate `beta.spurna.org` app source is in the private
`GoWVU1/spurna-web` repository (a static Next.js export), not this repository.
Its current `/election/` pages contain labeled fictional sample data. The
local viewer is the database-backed site implementation and does not modify
that app. Candidate profiles need a separate integration there if that app is
the eventual production site.

The landing-page Lawmakers and Candidates links appear automatically when
`/api/health` responds successfully; a static-only deployment leaves them
hidden. On 19 October 2026 the live local API returned all 109 candidates,
553 lawmakers (551 joint-fit members and two supplemental independents), and
69 score scopes per lawmaker profile. All 23 linked-candidate overall points
matched the corresponding lawmaker exactly. All 4,862 cited evidence IDs
across candidate profiles resolved to a syntactically valid source URL; this
does not establish that every external page remains live.

The newest selected national fit includes the September 2026 tweet refresh,
but its fit status is **diagnostic** because of sampler convergence warnings.
Its current held-out vote prediction accuracy has not been remeasured, so the
previous roughly 90% figure must not be reported as an accuracy result for
this refreshed fit. The viewer exposes the fit status and source of each
candidate score.

## Strict shared-rubric bridge check (15 October 2026)

A separate read-only test compared a 20-issue rhetoric-to-v4 Ridge bridge
against a party-mean baseline. It used 532 lawmaker anchors, 24 candidate
evidence-coverage patterns, Ridge alpha 20, and state-held-out folds; candidate
coverage patterns from the held-out state were excluded from each fold. The
target export came from diagnostic fit
`draws_ga119_1792038184878796000.npz` (SHA-256 prefix `91247045c4df`).

Across 532 held-out lawmakers, Ridge MAE was 3.392 points versus 3.799 for
party-only. On the more relevant linked-candidate check (11 people), Ridge MAE
was 4.386 versus 4.326 for party-only. The candidate-like check therefore
showed no improvement, despite a small gain on the much larger lawmaker set.
The diagnostic fit's preview produced 13 unlinked statement estimates, 23
exact linked-lawmakers, and 73 records below the shared-rubric evidence gate.

The Ridge bridge did not justify additional point scores on its own. The later
issue-based estimates are a separate provisional method and should be read
with their evidence counts and source labels.
