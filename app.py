#!/usr/bin/env python3
"""
MEOW Flask backend.

Loads resources.json once into memory, then serves a JSON API for
filtered, sorted, paginated results and facet counts.  The frontend
only receives the data it needs for the current view.

Routes
------
GET  /                      → index.html
GET  /api/metadata          → dataset stats + language/keyword insights
GET  /api/resources         → filtered, paginated resources + facet counts
POST /admin/reload          → hot-reload data without restarting
"""

import json
import re
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATA_DIR            = Path(__file__).parent / "data"
RESOURCES_PATH      = DATA_DIR / "resources.json"
METADATA_PATH       = DATA_DIR / "metadata.json"
PAGE_SIZE           = 48
DATA_WATCH_INTERVAL = 300  # seconds between mtime checks

RESOURCE_TYPES: Dict[str, Dict[str, str]] = {
    "Q43":    {"label": "Application",        "pluralLabel": "applications"},
    "Q53":    {"label": "Annual report",       "pluralLabel": "annual reports"},
    "Q55":    {"label": "Audit report",        "pluralLabel": "audit reports"},
    "Q44583": {"label": "Article",             "pluralLabel": "articles"},
    "Q22266": {"label": "Budget",              "pluralLabel": "budgets"},
    "Q23237": {"label": "Blog post",           "pluralLabel": "blog posts"},
    "Q23367": {"label": "Brochure",            "pluralLabel": "brochures"},
    "Q22136": {"label": "Case study",          "pluralLabel": "case studies"},
    "Q25288": {"label": "Conference paper",    "pluralLabel": "conference papers"},
    "Q21996": {"label": "Fail fest",           "pluralLabel": "fail fests"},
    "Q54":    {"label": "Financial statement", "pluralLabel": "financial statements"},
    "Q25817": {"label": "Grant proposal",      "pluralLabel": "grant proposals"},
    "Q21954": {"label": "Guide",               "pluralLabel": "guides"},
    "Q23360": {"label": "Guideline",           "pluralLabel": "guidelines"},
    "Q31862": {"label": "Handbook",            "pluralLabel": "handbooks"},
    "Q23351": {"label": "How-to",              "pluralLabel": "how-tos"},
    "Q24134": {"label": "Manual",              "pluralLabel": "manuals"},
    "Q57":    {"label": "Minutes",             "pluralLabel": "minutes"},
    "Q45501": {"label": "Online course",       "pluralLabel": "online courses"},
    "Q36499": {"label": "Operational plan",    "pluralLabel": "operational plans"},
    "Q44":    {"label": "Poster",              "pluralLabel": "posters"},
    "Q23235": {"label": "Podcast episode",     "pluralLabel": "podcast episodes"},
    "Q29":    {"label": "Report",              "pluralLabel": "reports"},
    "Q23251": {"label": "Scholarly article",   "pluralLabel": "scholarly articles"},
    "Q62":    {"label": "Slide deck",          "pluralLabel": "slide decks"},
    "Q21993": {"label": "Story",               "pluralLabel": "stories"},
    "Q36469": {"label": "Strategic plan",      "pluralLabel": "strategic plans"},
    "Q23276": {"label": "Tutorial",            "pluralLabel": "tutorials"},
    "Q21950": {"label": "Video",               "pluralLabel": "videos"},
    "Q45522": {"label": "Video tutorial",      "pluralLabel": "video tutorials"},
    "Q23258": {"label": "Wikibooks book",      "pluralLabel": "Wikibooks books"},
    "Q23260": {"label": "Wikiversity course",  "pluralLabel": "Wikiversity courses"},
    "Q47":    {"label": "White paper",         "pluralLabel": "white papers"},
    "Q76":    {"label": "Final report",        "pluralLabel": "final reports"},
}

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent

app = Flask(
    __name__,
    static_folder=str(_HERE / "assets"),
    static_url_path="/assets",
)

# ---------------------------------------------------------------------------
# In-memory data store (protected by an RLock)
# ---------------------------------------------------------------------------

_data_lock       = threading.RLock()
_resources:      List[Dict[str, Any]] = []
_metadata:       Dict[str, Any]       = {}
_insights:       Dict[str, Any]       = {}
_resources_mtime: float               = 0.0


def load_data() -> None:
    """Read data files from disk and refresh the in-memory store."""
    global _resources, _metadata, _insights, _resources_mtime

    try:
        new_resources = json.loads(RESOURCES_PATH.read_text(encoding="utf-8"))
        new_metadata  = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        new_mtime     = RESOURCES_PATH.stat().st_mtime
        new_insights  = _compute_insights(new_resources)

        with _data_lock:
            _resources       = new_resources
            _metadata        = new_metadata
            _insights        = new_insights
            _resources_mtime = new_mtime

        print(f"[MEOW] Loaded {len(new_resources)} resources.")
    except FileNotFoundError as exc:
        print(f"[MEOW] Data file not found ({exc}). Serving empty dataset.")
    except Exception as exc:
        print(f"[MEOW] Error loading data: {exc}")


def _watch_data() -> None:
    """Background thread: reload data when resources.json changes on disk."""
    while True:
        time.sleep(DATA_WATCH_INTERVAL)
        try:
            new_mtime = RESOURCES_PATH.stat().st_mtime
            with _data_lock:
                current = _resources_mtime
            if new_mtime > current:
                print("[MEOW] Data files changed — reloading…")
                load_data()
        except Exception:
            pass  # file may not exist yet; keep watching


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def _extract_year(pub_date: str) -> str:
    """Return the 4-digit year from a Wikibase date string, or empty string."""
    m = re.search(r"(\d{4})", pub_date or "")
    return m.group(1) if m else ""


def _has_any(values: List[str], selected: List[str]) -> bool:
    return any(v in selected for v in values)


def _apply_filters(
    resources: List[Dict[str, Any]],
    *,
    q: str = "",
    types: Optional[List[str]] = None,
    language: str = "",
    year: str = "",
    subjects: Optional[List[str]] = None,
    publishers: Optional[List[str]] = None,
    authors: Optional[List[str]] = None,
    missing_flags: Optional[set] = None,
    exclude: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Filter resources against the given criteria.

    exclude: one of "types", "language", "year", "subjects",
             "publishers", "authors" — that dimension is skipped,
             enabling context-aware facet counts (conjunctive faceted search).
    """
    types         = types         or []
    subjects      = subjects      or []
    publishers    = publishers    or []
    authors       = authors       or []
    missing_flags = missing_flags or set()

    result = []
    for r in resources:
        # Full-text search across several fields
        if q:
            haystack = " ".join([
                r.get("id", ""),
                r.get("title", ""),
                r.get("description", ""),
                " ".join(r.get("publishers", [])),
                " ".join(r.get("authors", [])),
                " ".join(r.get("languages", [])),
                " ".join(r.get("subjects", [])),
            ]).lower()
            if q not in haystack:
                continue

        if exclude != "types" and types:
            if not _has_any(r.get("typeIds", []), types):
                continue

        if exclude != "language" and language:
            if language not in r.get("languages", []):
                continue

        if exclude != "year" and year:
            if _extract_year(r.get("publicationDate", "")) != year:
                continue

        if exclude != "subjects" and subjects:
            if not _has_any(r.get("subjects", []), subjects):
                continue

        if exclude != "publishers" and publishers:
            if not _has_any(r.get("publishers", []), publishers):
                continue

        if exclude != "authors" and authors:
            if not _has_any(r.get("authors", []), authors):
                continue

        miss = r.get("missing", {})
        if "description"    in missing_flags and not miss.get("description"):
            continue
        if "subject"        in missing_flags and not miss.get("mainSubject"):
            continue
        if "language"       in missing_flags and not miss.get("language"):
            continue
        if "pubdate"        in missing_flags and not miss.get("publicationDate"):
            continue
        if "unlinkedauthor" in missing_flags and not miss.get("unlinkedAuthor"):
            continue

        result.append(r)
    return result


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------

def _sort_resources(resources: List[Dict[str, Any]], sort: str) -> List[Dict[str, Any]]:
    def q_num(r: Dict[str, Any]) -> int:
        m = re.match(r"Q(\d+)", r.get("id", ""), re.IGNORECASE)
        return int(m.group(1)) if m else 10 ** 9

    def title_key(r: Dict[str, Any]) -> str:
        return (r.get("title") or "").lower()

    def type_label(r: Dict[str, Any]) -> str:
        type_id = (r.get("typeIds") or [""])[0]
        return RESOURCE_TYPES.get(type_id, {}).get("label", type_id).lower()

    def sortable_date(r: Dict[str, Any]) -> str:
        pub = str(r.get("publicationDate") or "").lstrip("+")
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", pub)
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""

    if sort == "id-asc":
        return sorted(resources, key=q_num)
    if sort == "id-desc":
        return sorted(resources, key=q_num, reverse=True)
    if sort == "type":
        return sorted(resources, key=lambda r: (type_label(r), title_key(r)))
    if sort in ("date-asc", "date-desc"):
        has_date = [r for r in resources if sortable_date(r)]
        no_date  = [r for r in resources if not sortable_date(r)]
        has_date.sort(
            key=lambda r: (sortable_date(r), title_key(r)),
            reverse=(sort == "date-desc"),
        )
        no_date.sort(key=title_key)
        return has_date + no_date
    # default: title
    return sorted(resources, key=title_key)


# ---------------------------------------------------------------------------
# Facet counters
# ---------------------------------------------------------------------------

def _count_types(pool: List[Dict]) -> Dict[str, int]:
    c: Counter = Counter()
    for r in pool:
        for t in r.get("typeIds", []):
            c[t] += 1
    return dict(c)

def _count_languages(pool: List[Dict]) -> Dict[str, int]:
    c: Counter = Counter()
    for r in pool:
        for l in r.get("languages", []):
            c[l] += 1
    return dict(c)

def _count_years(pool: List[Dict]):
    c: Counter = Counter()
    no_date = 0
    for r in pool:
        y = _extract_year(r.get("publicationDate", ""))
        if y:
            c[y] += 1
        else:
            no_date += 1
    return dict(c), no_date

def _count_subjects(pool: List[Dict]) -> Dict[str, int]:
    c: Counter = Counter()
    for r in pool:
        for s in r.get("subjects", []):
            c[s] += 1
    return dict(c)

def _count_publishers(pool: List[Dict]) -> Dict[str, int]:
    c: Counter = Counter()
    for r in pool:
        for p in r.get("publishers", []):
            c[p] += 1
    return dict(c)

def _count_authors(pool: List[Dict]) -> Dict[str, int]:
    c: Counter = Counter()
    for r in pool:
        for a in r.get("authors", []):
            c[a] += 1
    return dict(c)


# ---------------------------------------------------------------------------
# Insights (computed once at load time, used by the modal dialogs)
# ---------------------------------------------------------------------------

def _compute_insights(resources: List[Dict[str, Any]]) -> Dict[str, Any]:
    # --- Language insights ---
    lang_counts: Counter = Counter()
    with_lang = missing_lang = mono = bi = multi = 0

    for r in resources:
        langs = r.get("languages", [])
        n = len(langs)
        if n == 0:
            missing_lang += 1
        else:
            with_lang += 1
        if n == 1:   mono  += 1
        elif n == 2: bi    += 1
        elif n >= 3: multi += 1
        for l in langs:
            lang_counts[l] += 1

    top_langs = lang_counts.most_common()
    rare_langs = [(l, c) for l, c in top_langs if c <= 2]

    # --- Keyword insights ---
    kw_counts: Counter = Counter()
    with_kw = missing_kw = kw0 = kw12 = kw35 = kw6p = 0

    for r in resources:
        subjs = r.get("subjects", [])
        n = len(subjs)
        if n == 0:
            missing_kw += 1
            kw0 += 1
        else:
            with_kw += 1
            if n <= 2:   kw12 += 1
            elif n <= 5: kw35 += 1
            else:        kw6p += 1
        for s in subjs:
            kw_counts[s] += 1

    top_kws  = kw_counts.most_common()
    rare_kws = [(k, c) for k, c in top_kws if c <= 2]

    return {
        "languages": {
            "topLanguages":    [{"language": l, "count": c} for l, c in top_langs[:15]],
            "rareLanguages":   [{"language": l, "count": c} for l, c in rare_langs],
            "withLanguage":    with_lang,
            "missingLanguage": missing_lang,
            "monolingual":     mono,
            "bilingual":       bi,
            "multilingual":    multi,
            "maxCount":        top_langs[0][1] if top_langs else 0,
        },
        "keywords": {
            "topKeywords":     [{"keyword": k, "count": c} for k, c in top_kws[:20]],
            "rareKeywords":    [{"keyword": k, "count": c} for k, c in rare_kws],
            "withKeywords":    with_kw,
            "missingKeywords": missing_kw,
            "zero":            kw0,
            "oneTwo":          kw12,
            "threeToFive":     kw35,
            "sixPlus":         kw6p,
            "maxCount":        top_kws[0][1] if top_kws else 0,
        },
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(_HERE, "index.html")


@app.route("/api/metadata")
def api_metadata():
    """
    Returns the stored metadata enriched with pre-computed insights.
    Used by the frontend to populate the header timestamp, summary stats,
    and the language/keyword insight modals.
    """
    with _data_lock:
        meta     = dict(_metadata)
        insights = dict(_insights)
    meta["insights"] = insights
    return jsonify(meta)


@app.route("/api/resources")
def api_resources():
    """
    Returns filtered, sorted, paginated resources plus context-aware
    facet counts for all filter panels.

    Query params
    ------------
    q           free-text search
    type        resource type Q-ID (repeatable)
    lang        language label
    year        4-digit publication year
    subject     keyword/subject label (repeatable)
    publisher   publisher label (repeatable)
    author      author label (repeatable)
    missing     comma-separated flags: description, subject, language,
                pubdate, unlinkedauthor
    sort        title | date-desc | date-asc | type | id-asc | id-desc
    page        1-based page number (default 1)
    all         1 = return all results without pagination (for CSV export)
    """
    # Parse params
    q           = request.args.get("q", "").strip().lower()
    types       = request.args.getlist("type")
    language    = request.args.get("lang", "")
    year        = request.args.get("year", "")
    subjects    = request.args.getlist("subject")
    publishers  = request.args.getlist("publisher")
    authors     = request.args.getlist("author")
    missing_str = request.args.get("missing", "")
    missing_flags = set(missing_str.split(",")) if missing_str else set()
    sort        = request.args.get("sort", "id-desc")
    export_all  = request.args.get("all", "0") == "1"

    try:
        page = max(1, int(request.args.get("page", 1) or 1))
    except (ValueError, TypeError):
        page = 1

    # Shared filter kwargs (no exclude)
    fkw: Dict[str, Any] = dict(
        q=q, types=types, language=language, year=year,
        subjects=subjects, publishers=publishers, authors=authors,
        missing_flags=missing_flags,
    )

    with _data_lock:
        resources = _resources  # safe: we only ever replace, never mutate

    # Main filtered + sorted set
    filtered = _apply_filters(resources, **fkw)
    filtered = _sort_resources(filtered, sort)
    total    = len(filtered)

    # Facets: each dimension is computed with itself excluded so the panel
    # shows context-aware counts (standard conjunctive faceted search).
    year_counts, year_no_date = _count_years(
        _apply_filters(resources, **fkw, exclude="year")
    )
    facets = {
        "types":      _count_types(     _apply_filters(resources, **fkw, exclude="types")),
        "languages":  _count_languages( _apply_filters(resources, **fkw, exclude="language")),
        "years":      year_counts,
        "yearNoDate": year_no_date,
        "subjects":   _count_subjects(  _apply_filters(resources, **fkw, exclude="subjects")),
        "publishers": _count_publishers(_apply_filters(resources, **fkw, exclude="publishers")),
        "authors":    _count_authors(   _apply_filters(resources, **fkw, exclude="authors")),
    }

    if export_all:
        return jsonify({"results": filtered, "total": total, "facets": facets})

    # Paginate
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page        = min(page, total_pages)
    start       = (page - 1) * PAGE_SIZE
    page_items  = filtered[start : start + PAGE_SIZE]

    return jsonify({
        "total":      total,
        "page":       page,
        "totalPages": total_pages,
        "pageSize":   PAGE_SIZE,
        "results":    page_items,
        "facets":     facets,
    })


@app.route("/admin/reload", methods=["POST"])
def admin_reload():
    """
    Hot-reload data files without restarting the server.
    The harvester can POST here after writing new JSON files.
    """
    load_data()
    with _data_lock:
        count = len(_resources)
    return jsonify({"status": "ok", "resourceCount": count})


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

load_data()

_watcher = threading.Thread(target=_watch_data, daemon=True)
_watcher.start()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
