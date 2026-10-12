# Candidate viewer

The `/candidates/` page reads 2026 ballot-verified candidate profiles from
PostgreSQL. Scores and source text stay in the database; this repository contains
only the presentation and a small read-only API.

The API in `server.py` serves:

- `GET /api/candidates` — roster, score status, and provisional overall score
- `GET /api/candidates/<candidate_id>` — issue positions and source links

It reads `mart.us_candidate_scorecard_2026` and
`mart.us_candidate_issue_score_2026`. The scoring code and view definitions live
in the PoliticsApp repository under `analytics/`.

For local review, install `requirements.txt`, set `DATABASE_URL` to a PostgreSQL URL or set
`POLITICSAPP_ENV_FILE` to a local `.env` file containing it, then run
`python server.py --port 8766` and open `http://127.0.0.1:8766/candidates/`.
Use a database account with SELECT-only privileges for a hosted deployment.

The current `spurna.org` site is served as static files. Its hosting needs an
API process or proxy for `/api/candidates` before linking the new page in the
public navigation. The separate `beta.spurna.org` app source is not in this
repository, so this code does not modify that app.

Candidate issue scores are agentic evidence estimates. An overall left–right
score appears only after at least four cited Tier A/B issue positions pass the
confidence gate. It is not calibrated to the national v4 vote-fit scale.
