"""Local/hosted Spurna site server with read-only candidate score APIs.

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
        if path == "/api/candidates":
            return self.candidates()
        if path.startswith("/api/candidates/"):
            candidate_id = path.removeprefix("/api/candidates/").strip("/")
            return self.candidate(candidate_id)
        parts = [part for part in path.split("/") if part]
        if (any(part.startswith(".") for part in parts)
                or (path not in {"/", "/candidates/"}
                    and Path(path).suffix.lower() not in PUBLIC_EXTENSIONS)):
            return self.send_error(404)
        return super().do_GET()

    def candidates(self):
        try:
            with connection() as conn, conn.cursor() as cur:
                cur.execute("""SELECT candidate_id, display_name, party, state,
                                      office, district, linked_member_index_code,
                                      issue_count, cited_issue_count,
                                      overall_lr_bucket, overall_lr_score_approx,
                                      score_scale, score_status
                                 FROM mart.us_candidate_scorecard_2026
                                ORDER BY state, office, district, display_name""")
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
                cur.execute("""SELECT candidate_id, display_name, party, state,
                                      office, district, status, campaign_website,
                                      linked_member_index_code, issue_count,
                                      cited_issue_count, overall_lr_bucket,
                                      overall_lr_score_approx, economic_axis_bucket,
                                      social_axis_bucket, lr_method_note, score_scale,
                                      score_status
                                 FROM mart.us_candidate_scorecard_2026
                                WHERE candidate_id=%s""", (candidate_id,))
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
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if os.environ.get("POLITICSAPP_ENV_FILE"):
        from dotenv import load_dotenv
        load_dotenv(os.environ["POLITICSAPP_ENV_FILE"])
    if not os.environ.get("DATABASE_URL"):
        parser.error("DATABASE_URL is required")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Spurna candidate preview: http://127.0.0.1:{args.port}/candidates/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
