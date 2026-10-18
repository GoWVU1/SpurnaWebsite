"""Fill missing candidate overall scores from cited issue positions.

This deliberately leaves linked v4 scores and existing calibrated statement
estimates untouched. It fits the issue-score mean to linked lawmakers on the
same national v4 display scale, then marks the added scores as provisional.

Set DATABASE_URL (or POLITICSAPP_ENV_FILE) and run from this repository:
    python scripts/publish_candidate_issue_estimates.py
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


SOURCE = "candidate_issue_based_estimate"
METHOD = "cited_issue_weighted_mean_v4_linear_v1"


def database_url():
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = os.environ.get("POLITICSAPP_ENV_FILE")
    if env_path:
        for line in Path(env_path).read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.partition("=")[2].strip().strip('"').strip("'")
    raise RuntimeError("Set DATABASE_URL or POLITICSAPP_ENV_FILE")


def regress(pairs):
    xbar = sum(x for x, _ in pairs) / len(pairs)
    ybar = sum(y for _, y in pairs) / len(pairs)
    variance = sum((x - xbar) ** 2 for x, _ in pairs)
    if variance < 1e-8:
        raise ValueError("Linked-candidate issue scores have no usable spread")
    slope = sum((x - xbar) * (y - ybar) for x, y in pairs) / variance
    return ybar - slope * xbar, slope


def main():
    with psycopg.connect(database_url(), connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT fit_sha FROM mart.us_national_v4_fits
                            WHERE congress=119 AND load_status='complete'
                            ORDER BY imported_at DESC LIMIT 1""")
            fit = cur.fetchone()
            if not fit:
                raise RuntimeError("No complete 119th-Congress fit")
            fit_sha = fit[0]
            cur.execute("""SELECT candidate_id,party,state,linked_member_id,
                                  site_position_points,cited_issue_count,calibration_summary
                             FROM mart.us_candidate_v4_calibrations
                            WHERE fit_sha=%s ORDER BY candidate_id""", (fit_sha,))
            candidates = {r[0]: r for r in cur.fetchall()}
            if len(candidates) < 100:
                raise RuntimeError("Expected a complete ballot-verified calibration set")
            cur.execute("""SELECT candidate_id,continuous_score,confidence,emphasis
                             FROM mart.us_candidate_issue_score_2026
                            WHERE continuous_score IS NOT NULL
                              AND confidence >= 0.35
                              AND emphasis > 0
                              AND stance NOT IN ('unknown','no_position')
                              AND jsonb_array_length(evidence_doc_ids) > 0""")
            signals = defaultdict(list)
            for candidate_id,score,confidence,emphasis in cur.fetchall():
                if candidate_id in candidates:
                    signals[candidate_id].append((float(score), float(confidence) * float(emphasis)))
            issue_mean = {
                candidate_id: sum(score * weight for score,weight in rows) / sum(weight for _,weight in rows)
                for candidate_id,rows in signals.items()
            }
            cur.execute("""SELECT member_id,display_points
                             FROM mart.us_national_v4_member_scores
                            WHERE fit_sha=%s AND scope_id='OVERALL_BALANCED'""", (fit_sha,))
            lawmakers = dict(cur.fetchall())

            anchors = [(candidate_id, issue_mean[candidate_id], float(lawmakers[row[3]]), row[2])
                       for candidate_id,row in candidates.items()
                       if candidate_id in issue_mean and row[3] in lawmakers]
            if len(anchors) < 20 or len({r[3] for r in anchors}) < 3:
                raise RuntimeError("Too few linked lawmakers to calibrate issue estimates")
            intercept,slope = regress([(r[1],r[2]) for r in anchors])
            heldout = []
            for state in {r[3] for r in anchors}:
                train = [(r[1],r[2]) for r in anchors if r[3] != state]
                if len(train) < 10:
                    continue
                a,b = regress(train)
                heldout.extend(abs(a+b*r[1]-r[2]) for r in anchors if r[3] == state)
            mae = sum(heldout) / len(heldout) if heldout else None
            if not 0 < slope < 100 or not -50 < intercept < 50:
                raise RuntimeError("Issue mapping fell outside expected bounds")

            updates = []
            for candidate_id,row in candidates.items():
                if row[4] is not None or candidate_id not in issue_mean:
                    continue
                raw = intercept + slope * issue_mean[candidate_id]
                value = max(-50, min(50, round(raw)))
                summary = dict(row[6] or {})
                summary["issue_based_estimate"] = {
                    "method": METHOD,
                    "fit_sha": fit_sha,
                    "cited_scored_issues": len(signals[candidate_id]),
                    "anchor_count": len(anchors),
                    "intercept": round(intercept, 5),
                    "slope": round(slope, 5),
                    "state_holdout_mae_full_evidence": round(mae, 2) if mae is not None else None,
                    "limitation": "Sparse and third-party candidates were not directly validated.",
                }
                updates.append((value,SOURCE,METHOD,mae,Jsonb(summary),fit_sha,candidate_id))
            missing_issues = [candidate_id for candidate_id,row in candidates.items()
                              if row[4] is None and row[5] > 0 and candidate_id not in issue_mean]
            if missing_issues:
                raise RuntimeError(f"{len(missing_issues)} cited candidates lack usable issue scores")
            cur.executemany("""UPDATE mart.us_candidate_v4_calibrations
                                SET site_position_points=%s,position_source=%s,
                                    calibration_method=%s,state_holdout_mae_points=%s,
                                    calibration_summary=%s,imported_at=now()
                              WHERE fit_sha=%s AND candidate_id=%s
                                AND site_position_points IS NULL""", updates)
            cur.execute("""SELECT position_source,count(*)
                             FROM mart.us_candidate_v4_calibrations
                            WHERE fit_sha=%s GROUP BY position_source
                            ORDER BY position_source""", (fit_sha,))
            counts = dict(cur.fetchall())
        conn.commit()
    print(json.dumps({"fit_sha":fit_sha,"anchor_count":len(anchors),
                      "state_holdout_mae":round(mae,2) if mae is not None else None,
                      "added_issue_estimates":len(updates),"sources":counts},indent=2))


if __name__ == "__main__":
    main()
