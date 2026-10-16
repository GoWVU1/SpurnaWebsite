# Cloudflare deployment

The viewer builds into a Cloudflare Worker with static assets. Candidate and
lawmaker data remain in PostgreSQL; the Worker does not export a data snapshot
into the repository.

## Required database access

Create a dedicated PostgreSQL login for the Worker. It needs `CONNECT` on
`postgres`, `USAGE` on `mart` and `us_corpus`, and `SELECT` on only these
relations:

- `mart.us_candidate_scorecard_2026`
- `mart.us_candidate_v4_calibrations`
- `mart.us_candidate_v4_statement_bridge_preview`
- `mart.us_candidate_issue_score_2026`
- `mart.us_national_v4_fits`
- `mart.us_national_v4_member_scores`
- `mart.us_national_v4_senate_independent_scores`
- `us_corpus.documents`

Do not use the existing `SpurnaDB1` login: it can write to those tables. Keep
the new password out of Git, chat, and command history. The RDS connection must
use TLS.

## Create the Hyperdrive binding

In Cloudflare, create a Hyperdrive configuration that points to the database
using the dedicated read-only login. Bind it to this Worker as `CANDIDATE_DB`,
then add the generated Hyperdrive ID to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  { "binding": "CANDIDATE_DB", "id": "<generated-hyperdrive-id>" }
]
```

The binding's connection string is managed by Cloudflare and is not stored in
this repository. The Worker also starts each request with `BEGIN READ ONLY`.

## Build and deploy a preview

```sh
npm ci
npm run build
npm run deploy
```

With `workers_dev` enabled, Wrangler publishes a `workers.dev` preview. Check
`/api/health`, `/api/candidates`, `/api/lawmakers`, `/candidates/`, and
`/lawmakers/` there before connecting any custom domain. This repository's
`CNAME` and existing site routing are not changed by the preview deployment.

Cloudflare references: [Hyperdrive setup](https://developers.cloudflare.com/hyperdrive/get-started/),
[local Hyperdrive development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/),
and [Worker static assets](https://developers.cloudflare.com/workers/static-assets/).
