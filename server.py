"""Local/hosted Spurna site server with read-only national score APIs.

Run with DATABASE_URL set, or POLITICSAPP_ENV_FILE pointing to a local .env:
    python server.py --port 8766

The source of truth is PostgreSQL. No candidate score data is bundled with
the website repository.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg2


ROOT = Path(__file__).resolve().parent
CANDIDATE_ID = re.compile(r"^[0-9a-f]{20}$")
MEMBER_ID = re.compile(r"^[A-Z][0-9]{6}$")
BILL_ID = re.compile(r"^(\d{3}):(HR|S|HRES|SRES|HJRES|SJRES)(\d+)$", re.I)
PUBLIC_EXTENSIONS = {".html", ".css", ".js", ".svg", ".jpg", ".jpeg",
                     ".png", ".ico", ".webp", ".woff2", ".txt", ".xml"}


def official_bill_source(document_id):
    match = BILL_ID.fullmatch(document_id)
    if not match:
        return None
    congress, kind, number = match.groups()
    bill_type = {
        "HR": "house-bill", "S": "senate-bill",
        "HRES": "house-resolution", "SRES": "senate-resolution",
        "HJRES": "house-joint-resolution", "SJRES": "senate-joint-resolution",
    }[kind.upper()]
    return {"document_id": document_id,
            "title": f"{congress}th Congress · {kind.upper()} {number}",
            "url": f"https://www.congress.gov/bill/{congress}th-congress/{bill_type}/{number}"}


def connection():
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=10)
    conn.set_session(readonly=True)
    return conn


def records(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, value, status=200):
        body = json.dumps(value, default=str, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            try:
                with connection() as conn, conn.cursor() as cur:
                    cur.execute("SELECT 1")
                return self.send_json({"ok": True})
            except (psycopg2.Error, KeyError):
                return self.send_json({"ok": False}, 503)
        if path == "/api/candidates":
            return self.candidates()
        if path.startswith("/api/candidates/"):
            candidate_id = path.removeprefix("/api/candidates/").strip("/")
            return self.candidate(candidate_id)
        if path == "/api/lawmakers":
            return self.lawmakers()
        if path.startswith("/api/lawmakers/"):
            member_id = path.removeprefix("/api/lawmakers/").strip("/")
            return self.lawmaker(member_id)
        parts = [part for part in path.split("/") if part]
        if (any(part.startswith(".") for part in parts)
                or (path not in {"/", "/candidates/", "/lawmakers/"}
                    and Path(path).suffix.lower() not in PUBLIC_EXTENSIONS)):
            return self.send_error(404)
        return super().do_GET()

    @staticmethod
    def selected_national_fit(cur):
        """Use the newest converged fit, or the original site fit as fallback."""
        cur.execute("""SELECT fit_sha,status,archive_filename
                         FROM mart.us_national_v4_fits
                        WHERE congress=119 AND load_status='complete'
                        ORDER BY CASE WHEN status='converged' THEN 0 ELSE 1 END,
                                 CASE WHEN status='converged' THEN imported_at END DESC,
                                 CASE WHEN status<>'converged' THEN imported_at END ASC
                        LIMIT 1""")
        return cur.fetchone()

    def lawmakers(self):
        try:
            with connection() as conn, conn.cursor() as cur:
                fit = self.selected_national_fit(cur)
                if fit is None:
                    return self.send_json({"error": "National scores are unavailable."}, 503)
                cur.execute("""SELECT member_id,member_name,party,chamber,
                                      display_points,theta_mean,score_status,evidence_total,
                                      'joint_v4' AS score_source
                                 FROM mart.us_national_v4_member_scores
                                WHERE fit_sha=%s AND scope_id='OVERALL_BALANCED'
                                ORDER BY chamber,member_name""", (fit[0],))
                rows = records(cur)
                cur.execute("""SELECT member_id,member_name,party,chamber,
                                      display_points,theta_mean,score_status,evidence_total,
                                      'senate_independent_refit' AS score_source
                                 FROM mart.us_national_v4_senate_independent_scores
                                WHERE fit_sha=%s AND scope_id='OVERALL_BALANCED'
                                ORDER BY member_name""", (fit[0],))
                rows.extend(records(cur))
                rows.sort(key=lambda row: (row["chamber"], row["member_name"]))
            self.send_json({"lawmakers": rows, "count": len(rows),
                            "fit_sha": fit[0], "fit_status": fit[1]})
        except (psycopg2.Error, KeyError) as exc:
            self.log_error("Lawmaker list unavailable: %s", type(exc).__name__)
            self.send_json({"error": "Lawmaker data is temporarily unavailable."}, 503)

    def lawmaker(self, member_id):
        if not MEMBER_ID.fullmatch(member_id):
            return self.send_json({"error": "Invalid lawmaker ID."}, 400)
        try:
            with connection() as conn, conn.cursor() as cur:
                fit = self.selected_national_fit(cur)
                if fit is None:
                    return self.send_json({"error": "National scores are unavailable."}, 503)
                cur.execute("""SELECT member_id,member_name,party,chamber,
                                      scope_id,scope_type,display_points,theta_mean,
                                      theta_sd,theta_q05,theta_q95,score_status,evidence_total,
                                      'joint_v4' AS score_source
                                 FROM mart.us_national_v4_member_scores
                                WHERE fit_sha=%s AND member_id=%s
                                ORDER BY CASE scope_type WHEN 'overall' THEN 0
                                         WHEN 'domain' THEN 1 ELSE 2 END,scope_id""",
                            (fit[0], member_id))
                rows = records(cur)
                if not rows:
                    cur.execute("""SELECT member_id,member_name,party,chamber,
                                          scope_id,scope_type,display_points,theta_mean,
                                          NULL::real AS theta_sd,theta_q05,theta_q95,
                                          score_status,evidence_total,
                                          'senate_independent_refit' AS score_source
                                     FROM mart.us_national_v4_senate_independent_scores
                                    WHERE fit_sha=%s AND member_id=%s
                                    ORDER BY CASE scope_type WHEN 'overall' THEN 0
                                             WHEN 'domain' THEN 1 ELSE 2 END,scope_id""",
                                (fit[0], member_id))
                    rows = records(cur)
            if not rows:
                return self.send_json({"error": "Lawmaker not found."}, 404)
            self.send_json({"lawmaker": rows[0], "scores": rows,
                            "fit_sha": fit[0], "fit_status": fit[1]})
        except (psycopg2.Error, KeyError) as exc:
            self.log_error("Lawmaker detail unavailable: %s", type(exc).__name__)
            self.send_json({"error": "Lawmaker data is temporarily unavailable."}, 503)

    def candidates(self):
        try:
            with connection() as conn, conn.cursor() as cur:
                fit = self.selected_national_fit(cur)
                cur.execute("""SELECT c.candidate_id, c.display_name, c.party, c.state,
                                      c.office, c.district, c.linked_member_index_code,
                                      c.issue_count, c.cited_issue_count,
                                      c.overall_lr_bucket, c.overall_lr_score_approx,
                                      c.score_scale, c.score_status,
                                      v.site_position_points, v.site_position_source,
                                      v.state_holdout_mae_points, v.site_model_version,
                                      v.fit_status, b.band_low AS rough_band_low,
                                      b.band_high AS rough_band_high,
                                      b.evidence_issues AS rough_evidence_issues,
                                      b.validation_mae_points AS rough_validation_mae_points
                                 FROM mart.us_candidate_scorecard_2026 c
                                 LEFT JOIN mart.us_candidate_v4_display v
                                   ON v.candidate_id = c.candidate_id
                                 LEFT JOIN mart.us_candidate_v4_statement_bridge_preview b
                                   ON b.candidate_id=c.candidate_id AND b.fit_sha=%s
                                ORDER BY c.state, c.office, c.district, c.display_name""",
                            (fit[0] if fit else "",))
                rows = records(cur)
            self.send_json({"candidates": rows, "count": len(rows)})
        except (psycopg2.Error, KeyError) as exc:
            self.log_error("Candidate list unavailable: %s", type(exc).__name__)
            self.send_json({"error": "Candidate data is temporarily unavailable."}, 503)

    def candidate(self, candidate_id):
        if not CANDIDATE_ID.fullmatch(candidate_id):
            return self.send_json({"error": "Invalid candidate ID."}, 400)
        try:
            with connection() as conn, conn.cursor() as cur:
                fit = self.selected_national_fit(cur)
                cur.execute("""SELECT c.candidate_id, c.display_name, c.party, c.state,
                                      c.office, c.district, c.status, c.campaign_website,
                                      c.linked_member_index_code, c.issue_count,
                                      c.cited_issue_count, c.overall_lr_bucket,
                                      c.overall_lr_score_approx, c.economic_axis_bucket,
                                      c.social_axis_bucket, c.lr_method_note, c.score_scale,
                                      c.score_status, v.site_position_points,
                                      v.site_position_source, v.state_holdout_mae_points,
                                      v.site_model_version, v.fit_status,
                                      b.band_low AS rough_band_low,
                                      b.band_high AS rough_band_high,
                                      b.evidence_issues AS rough_evidence_issues,
                                      b.validation_mae_points AS rough_validation_mae_points
                                 FROM mart.us_candidate_scorecard_2026 c
                                 LEFT JOIN mart.us_candidate_v4_display v
                                   ON v.candidate_id = c.candidate_id
                                 LEFT JOIN mart.us_candidate_v4_statement_bridge_preview b
                                   ON b.candidate_id=c.candidate_id AND b.fit_sha=%s
                                WHERE c.candidate_id=%s""", (fit[0] if fit else "", candidate_id))
                profile_rows = records(cur)
                if not profile_rows:
                    return self.send_json({"error": "Candidate not found."}, 404)
                cur.execute("""SELECT issue_code, position_type, stance,
                                      continuous_score, confidence, emphasis,
                                      specificity, evidence_sufficiency,
                                      rhetoric_stance, action_stance,
                                      statement_action_reconciliation,
                                      evidence_doc_ids, claims, reasoning,
                                      model_version, computed_at
                                 FROM mart.us_candidate_issue_score_2026
                                WHERE candidate_id=%s ORDER BY issue_code""",
                            (candidate_id,))
                issues = records(cur)
                evidence_ids = sorted({doc_id for issue in issues
                                       for doc_id in issue["evidence_doc_ids"]})
                evidence = {}
                if evidence_ids:
                    cur.execute("""SELECT document_id, title,
                                          COALESCE(metadata->>'url', source_pk) AS url
                                     FROM us_corpus.documents
                                    WHERE document_id=ANY(%s)""", (evidence_ids,))
                    evidence = {row["document_id"]: row for row in records(cur)}
                    for document_id in evidence_ids:
                        if document_id not in evidence:
                            source = official_bill_source(document_id)
                            if source:
                                evidence[document_id] = source
            self.send_json({"candidate": profile_rows[0], "issues": issues,
                            "evidence": evidence})
        except (psycopg2.Error, KeyError) as exc:
            self.log_error("Candidate detail unavailable: %s", type(exc).__name__)
            self.send_json({"error": "Candidate data is temporarily unavailable."}, 503)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if os.environ.get("POLITICSAPP_ENV_FILE"):
        from dotenv import load_dotenv
        load_dotenv(os.environ["POLITICSAPP_ENV_FILE"])
    if not os.environ.get("DATABASE_URL"):
        parser.error("DATABASE_URL is required")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Spurna national preview: http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
