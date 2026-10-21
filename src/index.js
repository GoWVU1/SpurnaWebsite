import { Client } from "pg";
const CANDIDATE_ID = /^[0-9a-f]{20}$/;
const MEMBER_ID = /^[A-Z][0-9]{6}$/;
const BILL_ID = /^(\d{3}):(HCONRES|SCONRES|HJRES|SJRES|HRES|SRES|HR|S)(\d+)$/i;
const TWEET_ID = /^[0-9]{15,20}$/;

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function officialBillSource(documentId) {
  const match = BILL_ID.exec(documentId);
  if (!match) return null;
  const [, congress, kind, number] = match;
  const billType = {
    HR: "house-bill",
    S: "senate-bill",
    HRES: "house-resolution",
    SRES: "senate-resolution",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HCONRES: "house-concurrent-resolution",
    SCONRES: "senate-concurrent-resolution",
  }[kind.toUpperCase()];
  return {
    document_id: documentId,
    title: `${congress}th Congress · ${kind.toUpperCase()} ${number}`,
    url: `https://www.congress.gov/bill/${congress}th-congress/${billType}/${number}`,
  };
}

function referencedSource(documentId) {
  const bill = officialBillSource(documentId);
  if (bill) return bill;
  if (TWEET_ID.test(documentId)) {
    return { document_id: documentId, title: "View cited X post",
      url: `https://x.com/i/web/status/${documentId}` };
  }
  return null;
}

async function selectedNationalFit(client) {
  const result = await client.query(`SELECT fit_sha, status, archive_filename
      FROM mart.us_national_v4_fits f
     WHERE congress=119 AND load_status='complete'
       AND (SELECT count(*) FROM mart.us_candidate_v4_calibrations c
              WHERE c.fit_sha=f.fit_sha) >=
           (SELECT count(*) FROM mart.us_candidate_scorecard_2026
              WHERE ballot_verified)
     ORDER BY imported_at DESC
     LIMIT 1`);
  const fit = result.rows[0];
  if (!fit) return null;
  const supplement = await client.query(`SELECT f.fit_sha
      FROM mart.us_national_v4_fits f
     WHERE f.congress=119 AND f.load_status='complete'
       AND EXISTS (SELECT 1 FROM mart.us_national_v4_senate_independent_scores i
                    WHERE i.fit_sha=f.fit_sha)
       AND EXISTS (SELECT 1 FROM mart.us_candidate_v4_statement_bridge_preview b
                    WHERE b.fit_sha=f.fit_sha)
     ORDER BY f.imported_at DESC LIMIT 1`);
  fit.supplemental_sha = supplement.rows[0]?.fit_sha ?? fit.fit_sha;
  fit.slope = 1;
  fit.intercept = 0;
  if (fit.supplemental_sha !== fit.fit_sha) {
    const mapping = await client.query(`SELECT
        regr_slope(n.display_points::numeric, o.display_points::numeric) AS slope,
        regr_intercept(n.display_points::numeric, o.display_points::numeric) AS intercept
      FROM mart.us_national_v4_member_scores n
      JOIN mart.us_national_v4_member_scores o
        ON o.member_id=n.member_id AND o.scope_id=n.scope_id
      WHERE n.fit_sha=$1 AND o.fit_sha=$2 AND n.scope_id='OVERALL_BALANCED'`,
    [fit.fit_sha, fit.supplemental_sha]);
    if (mapping.rows[0]?.slope == null || mapping.rows[0]?.intercept == null) {
      fit.supplemental_sha = fit.fit_sha;
    } else {
      fit.slope = Number(mapping.rows[0].slope);
      fit.intercept = Number(mapping.rows[0].intercept);
    }
  }
  return fit;
}

function mapSupplementalPoints(rows, fit, fields = ["display_points"]) {
  if (fit.supplemental_sha === fit.fit_sha) return rows;
  for (const row of rows) {
    for (const field of fields) {
      if (row[field] != null) {
        row[field] = Math.max(-50, Math.min(50, Math.round(Number(row[field]) * fit.slope + fit.intercept)));
      }
    }
  }
  return rows;
}

function mapCandidateRanges(rows, fit) {
  mapSupplementalPoints(rows, fit, ["rough_band_low", "rough_band_high"]);
  if (fit.supplemental_sha !== fit.fit_sha) {
    for (const row of rows) {
      if (row.rough_validation_mae_points != null) {
        row.rough_validation_mae_points = Math.round(Number(row.rough_validation_mae_points) * Math.abs(fit.slope) * 10) / 10;
      }
    }
  }
  return rows;
}

async function lawmakers(client) {
  const fit = await selectedNationalFit(client);
  if (!fit) return json({ error: "National scores are unavailable." }, 503);
  const joint = await client.query(`SELECT member_id,member_name,party,chamber,
      display_points,theta_mean,score_status,evidence_total,
      'joint_v4' AS score_source
    FROM mart.us_national_v4_member_scores
    WHERE fit_sha=$1 AND scope_id='OVERALL_BALANCED'
    ORDER BY chamber,member_name`, [fit.fit_sha]);
  const senate = await client.query(`SELECT member_id,member_name,party,chamber,
      display_points,theta_mean,score_status,evidence_total,
      'senate_independent_refit' AS score_source
    FROM mart.us_national_v4_senate_independent_scores
    WHERE fit_sha=$1 AND scope_id='OVERALL_BALANCED'
    ORDER BY member_name`, [fit.supplemental_sha]);
  const rows = [...joint.rows, ...mapSupplementalPoints(senate.rows, fit)]
    .sort((a, b) => a.chamber.localeCompare(b.chamber) || a.member_name.localeCompare(b.member_name));
  return json({ lawmakers: rows, count: rows.length, fit_sha: fit.fit_sha, fit_status: fit.status });
}

async function lawmaker(client, memberId) {
  if (!MEMBER_ID.test(memberId)) return json({ error: "Invalid lawmaker ID." }, 400);
  const fit = await selectedNationalFit(client);
  if (!fit) return json({ error: "National scores are unavailable." }, 503);
  let result = await client.query(`SELECT member_id,member_name,party,chamber,
      scope_id,scope_type,display_points,theta_mean,theta_sd,theta_q05,theta_q95,
      score_status,evidence_total,'joint_v4' AS score_source
    FROM mart.us_national_v4_member_scores
    WHERE fit_sha=$1 AND member_id=$2
    ORDER BY CASE scope_type WHEN 'overall' THEN 0 WHEN 'domain' THEN 1 ELSE 2 END,scope_id`,
  [fit.fit_sha, memberId]);
  if (!result.rows.length) {
    result = await client.query(`SELECT member_id,member_name,party,chamber,
        scope_id,scope_type,display_points,theta_mean,NULL::real AS theta_sd,
        theta_q05,theta_q95,score_status,evidence_total,
        'senate_independent_refit' AS score_source
      FROM mart.us_national_v4_senate_independent_scores
      WHERE fit_sha=$1 AND member_id=$2
      ORDER BY CASE scope_type WHEN 'overall' THEN 0 WHEN 'domain' THEN 1 ELSE 2 END,scope_id`,
    [fit.supplemental_sha, memberId]);
    mapSupplementalPoints(result.rows, fit);
  }
  if (!result.rows.length) return json({ error: "Lawmaker not found." }, 404);
  return json({ lawmaker: result.rows[0], scores: result.rows, fit_sha: fit.fit_sha, fit_status: fit.status });
}

async function candidates(client) {
  const fit = await selectedNationalFit(client);
  const result = await client.query(`SELECT c.candidate_id,c.display_name,c.party,c.state,
      c.office,c.district,c.linked_member_index_code,c.issue_count,c.cited_issue_count,
      c.overall_lr_bucket,c.overall_lr_score_approx,c.score_scale,c.score_status,
      v.site_position_points,v.position_source AS site_position_source,
      v.state_holdout_mae_points,v.calibration_version AS site_model_version,
      $1::text AS fit_status,b.band_low AS rough_band_low,b.band_high AS rough_band_high,
      b.evidence_issues AS rough_evidence_issues,
      b.validation_mae_points AS rough_validation_mae_points
    FROM mart.us_candidate_scorecard_2026 c
    LEFT JOIN mart.us_candidate_v4_calibrations v
      ON v.candidate_id=c.candidate_id AND v.fit_sha=$2
    LEFT JOIN mart.us_candidate_v4_statement_bridge_preview b
      ON b.candidate_id=c.candidate_id AND b.fit_sha=$3
    ORDER BY c.state,c.office,c.district,c.display_name`,
  [fit?.status ?? "unavailable", fit?.fit_sha ?? "", fit?.supplemental_sha ?? ""]);
  return json({ candidates: fit ? mapCandidateRanges(result.rows, fit) : result.rows, count: result.rowCount });
}

async function candidate(client, candidateId) {
  if (!CANDIDATE_ID.test(candidateId)) return json({ error: "Invalid candidate ID." }, 400);
  const fit = await selectedNationalFit(client);
  const profile = await client.query(`SELECT c.candidate_id,c.display_name,c.party,c.state,
      c.office,c.district,c.status,c.campaign_website,c.linked_member_index_code,
      c.issue_count,c.cited_issue_count,c.overall_lr_bucket,c.overall_lr_score_approx,
      c.economic_axis_bucket,c.social_axis_bucket,c.lr_method_note,c.score_scale,c.score_status,
      v.site_position_points,v.position_source AS site_position_source,
      v.state_holdout_mae_points,v.calibration_version AS site_model_version,
      $1::text AS fit_status,b.band_low AS rough_band_low,b.band_high AS rough_band_high,
      b.evidence_issues AS rough_evidence_issues,
      b.validation_mae_points AS rough_validation_mae_points
    FROM mart.us_candidate_scorecard_2026 c
    LEFT JOIN mart.us_candidate_v4_calibrations v
      ON v.candidate_id=c.candidate_id AND v.fit_sha=$2
    LEFT JOIN mart.us_candidate_v4_statement_bridge_preview b
      ON b.candidate_id=c.candidate_id AND b.fit_sha=$3
    WHERE c.candidate_id=$4`,
  [fit?.status ?? "unavailable", fit?.fit_sha ?? "", fit?.supplemental_sha ?? "", candidateId]);
  if (!profile.rows.length) return json({ error: "Candidate not found." }, 404);
  if (fit) mapCandidateRanges(profile.rows, fit);

  const issueResult = await client.query(`SELECT issue_code,position_type,stance,
      continuous_score,confidence,emphasis,specificity,evidence_sufficiency,
      rhetoric_stance,action_stance,statement_action_reconciliation,evidence_doc_ids,
      claims,model_version,computed_at
    FROM mart.us_candidate_issue_score_2026
    WHERE candidate_id=$1 ORDER BY issue_code`, [candidateId]);
  const issues = issueResult.rows;
  const evidenceIds = [...new Set(issues.flatMap((issue) => issue.evidence_doc_ids ?? []))].sort();
  const evidence = {};
  if (evidenceIds.length) {
    const docs = await client.query(`SELECT document_id,title,
        COALESCE(metadata->>'url',source_pk) AS url
      FROM us_corpus.documents WHERE document_id=ANY($1::text[])`, [evidenceIds]);
    for (const row of docs.rows) evidence[row.document_id] = row;
    for (const documentId of evidenceIds) {
      if (!evidence[documentId]) {
        const source = referencedSource(documentId);
        if (source) evidence[documentId] = source;
      }
    }
  }
  return json({ candidate: profile.rows[0], issues, evidence });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    if (!env.CANDIDATE_DB?.connectionString) return json({ error: "Data service unavailable." }, 503);

    let client;
    try {
      client = new Client({ connectionString: env.CANDIDATE_DB.connectionString });
      await client.connect();
      await client.query("BEGIN READ ONLY");
      let response;
      if (url.pathname === "/api/health") {
        await client.query("SELECT 1");
        response = json({ ok: true });
      } else if (url.pathname === "/api/candidates") {
        response = await candidates(client);
      } else if (url.pathname.startsWith("/api/candidates/")) {
        response = await candidate(client, url.pathname.slice("/api/candidates/".length).replace(/\/$/, ""));
      } else if (url.pathname === "/api/lawmakers") {
        response = await lawmakers(client);
      } else if (url.pathname.startsWith("/api/lawmakers/")) {
        response = await lawmaker(client, url.pathname.slice("/api/lawmakers/".length).replace(/\/$/, ""));
      } else {
        response = json({ error: "Not found." }, 404);
      }
      await client.query("ROLLBACK");
      return response;
    } catch (error) {
      try { await client?.query("ROLLBACK"); } catch {}
      console.error("Read-only database request failed", error?.name ?? "Error", error?.code ?? "");
      return json({ error: "Data is temporarily unavailable." }, 503);
    } finally {
      try { await client?.end(); } catch {}
    }
  },
};
