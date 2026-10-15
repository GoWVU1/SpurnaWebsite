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
- `GET /api/lawmakers` — 551 joint-fit members plus Bernie Sanders and Angus King from the archived Senate-only refit when the original fit is selected
- `GET /api/lawmakers/<member_id>` — overall, 14 policy-area, and 54 detailed issue positions

It reads `mart.us_candidate_scorecard_2026`,
fit-keyed `mart.us_candidate_v4_calibrations`, and
`mart.us_candidate_issue_score_2026`, along with the versioned
`mart.us_national_v4_fits` and `mart.us_national_v4_member_scores`. The
scoring code and view definitions live
in the PoliticsApp repository under `analytics/`.

The API selects the most recent fully loaded, converged national fit with a
complete candidate calibration and independent Senate rows. Until one exists,
it serves the versioned fit-2 diagnostic calibration already on the site. The
lawmaker and candidate endpoints select the same fit. The API includes
`fit_status` so a diagnostic score can be identified explicitly. Each
calibration is also available by fit hash in
`mart.us_candidate_v4_calibrations`; rows without enough evidence keep a null
overall position.

For 17 more Democratic or Republican candidates with at least one shared-rubric
policy-statement issue and no calibrated point, the local viewer displays an
explicitly exploratory **range** from
`mart.us_candidate_v4_statement_bridge_preview`. It is tied to the original
diagnostic fit and never overrides a linked lawmaker score or calibrated
candidate point. The bridge trained on 534 lawmakers; its 18 state-held-out
linked-candidate checks had 6.11-point mean absolute error and misses up to
16.56 points. The displayed ±18/20/22-point spans are deliberately broad
research guides, not calibrated confidence intervals. Candidates without
usable policy statements or a suitable major-party calibration retain no
comparable number; their cited issue positions remain visible.

For local review, install `requirements.txt`, set `DATABASE_URL` to a PostgreSQL URL or set
`POLITICSAPP_ENV_FILE` to a local `.env` file containing it, then run
`python server.py --port 8766` and open `http://127.0.0.1:8766/candidates/`.
Use a database account with SELECT-only privileges for a hosted deployment.
On a hosted server, pass `--host 0.0.0.0` and put it behind HTTPS and a proxy
for `/api/` and `/candidates/`.

The lawmakers page now searches the 109 ballot-verified candidates alongside
lawmakers and links to candidate profiles. Independent senators are stored in
`mart.us_national_v4_senate_independent_scores`, separately from the joint fit;
their cards and profiles label the separate Senate refit as provisional.

The current `spurna.org` site is served as static files. Its hosting needs an
API process or proxy for `/api/candidates` before linking the new page in the
public navigation. The separate `beta.spurna.org` app source is in the private
`GoWVU1/spurna-web` repository (a static Next.js export), not this repository.
Its current `/election/` pages contain labeled fictional sample data. This
local viewer does not modify or deploy that app. Candidate profiles need a
separate integration there, with PostgreSQL remaining the source of truth and
published candidate data generated for the site's static build.
The landing-page Lawmakers and Candidates links appear automatically when
`/api/health` responds successfully; a static-only deployment leaves them
hidden. The local server was checked with 109 candidates, 553 lawmakers,
69 scores on a lawmaker detail page, and zero overall-score differences
across the 23 candidates linked to a lawmaker.

On 13 October 2026 all 109 ballot-verified candidates had completed 20 issue
cells in PostgreSQL. The scorecard classified 93 as scored and 16 as having
insufficient evidence for a position. The local API returned all 109 profiles.

Candidate issue scores are agentic evidence estimates. The overall position
uses the national v4 site's −50 to +50 display scale. For linked lawmakers it
is the site's published score; for Democratic and Republican candidates without
a linked 119th-Congress lawmaker score it is a public-statement estimate
calibrated on 23 overlapping lawmakers and labeled as such. The point
estimate requires at least four qualifying rhetoric signals under the current
calibration. Seventeen additional major-party candidates have broad exploratory
ranges; remaining candidates have no comparable number until evidence and
calibration anchors are available. The issue-level agentic scores have not
been calibrated to v4's 14 policy domains.

An audit on 15 October 2026 found 37 candidate point scores, 17 exploratory
major-party ranges, and 55 profiles without a comparable number among the 109
verified candidates. Fifty of those 55 are minor-party or independent; 37 of
those 50 have at least one cited issue stance. Party-only context was checked
with state-held-out lawmakers (7.10-point mean absolute error on the site's
±50 scale), but that describes a party distribution rather than an individual
candidate. The current shared-rubric bridge fails independent Senate transfer
checks for Sanders and King, so minor-party candidate numbers remain hidden.

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

This does not justify publishing additional Ridge point scores. The tested fit
is diagnostic and has a different hash from the site's saved fit-2 scale; it
does not replace the current fit-2 calibration. Keep the current 37 points, 17
broad exploratory ranges, and 55 profiles without a comparable overall number
until a candidate-like holdout shows a real gain. All candidate profiles and
cited issue evidence remain available independently of the overall-score gate.
