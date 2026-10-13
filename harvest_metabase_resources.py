#!/usr/bin/env python3
"""
Harvest educational resources from Metabase Wikibase Cloud and save them as JSON.

The harvest runs in three rounds of small, sequential SPARQL queries:

  1. one query listing every resource's Q-ID and type(s);
  2. the resources' labels, descriptions and statements, in batches of Q-IDs;
  3. the labels of the items those statements point at (authors, subjects, ...).

The files are written only if every query succeeded, so a failed run leaves
the previous harvest in place.

Creates:
  data/resources.json
  data/metadata.json

Usage:
  python3 harvest_metabase_resources.py
  python3 harvest_metabase_resources.py --output-dir data --pretty
"""

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple
from urllib.parse import quote

import requests


ENDPOINT = "https://metabase.wikibase.cloud/query/sparql"
APP_NAME = "MEOW"
DATA_SCHEMA_VERSION = 1
DEFAULT_USER_AGENT = "MEOWHarvester/2.0 (+https://meow.toolforge.org/)"

# Languages tried in order, for labels and descriptions and for choosing among
# a resource's titles (P8).
LABEL_LANGUAGES = ("mul", "en", "de", "it", "es", "pt", "sr", "bg", "pl", "sv", "pt-br", "fr")

# Never wait longer than this for a retry, whatever Retry-After says.
MAX_RETRY_DELAY = 120

# instance of (P5) this Q-ID marks the top of a "used by / part of" chain
# (P42 -> P17*) as a conference, e.g. Wikimania or GLAM Wiki.
EVENT_TYPE_ID = "Q42"

RESOURCE_TYPES = {
    "Q43":    {"label": "Application",        "pluralLabel": "applications"},
    "Q53":    {"label": "Annual report",       "pluralLabel": "annual reports"},
    "Q55":    {"label": "Audit report",        "pluralLabel": "audit reports"},
    "Q44583": {"label": "Article",             "pluralLabel": "articles"},
    "Q22266": {"label": "Budget",              "pluralLabel": "budgets"},
    "Q23237": {"label": "Blog post",           "pluralLabel": "blog posts"},
    "Q23367": {"label": "Brochure",            "pluralLabel": "brochures"},
    "Q22136": {"label": "Case study",          "pluralLabel": "case studies"},
    "Q25288": {"label": "Conference paper",    "pluralLabel": "conference papers"},
    "Q50361": {"label": "Conference proceedings", "pluralLabel": "conference proceedings"},
    "Q48606": {"label": "Exercise",            "pluralLabel": "exercises"},
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
    "Q2":     {"label": "Project",             "pluralLabel": "projects"},
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

# Extra "instance of" (P5) Q-IDs that should be harvested alongside a type
# already in RESOURCE_TYPES and folded into it, rather than treated as a
# distinct resource type. WikiProject items are lumped in with "project".
RESOURCE_TYPE_ALIASES = {
    "Q22926": "Q2",  # WikiProject -> Project
}


def canonical_type_id(type_id: str) -> str:
    """Map a harvested "instance of" Q-ID to its canonical resource type."""
    return RESOURCE_TYPE_ALIASES.get(type_id, type_id)


# Single-valued statements, as (property, record field).
SCALAR_PROPERTIES = (
    ("P8",  "titleProperty"),
    ("P1",  "wikidataId"),
    ("P44", "courseUrl"),
    ("P31", "commonsVideoPage"),
    ("P22", "commonsDocumentPage"),
    ("P59", "youtubeId"),
    ("P45", "wikiPage"),
    ("P11", "describedAtPage"),
    ("P12", "describedAtUrl"),
    ("P18", "publicationDate"),
)

# Statements pointing at other items, as (property, query variable, record
# field). The detail queries return only the Q-IDs; their labels are looked up
# once at the end instead of being repeated on every row.
LINKED_PROPERTIES = (
    ("P19", "author",      "authors"),
    ("P21", "publisher",   "publishers"),
    ("P20", "language",    "languages"),
    ("P15", "mainSubject", "subjects"),
)

PREFIXES = """
PREFIX wb: <https://metabase.wikibase.cloud/entity/>
PREFIX wbt: <https://metabase.wikibase.cloud/prop/direct/>
PREFIX p: <https://metabase.wikibase.cloud/prop/>
PREFIX ps: <https://metabase.wikibase.cloud/prop/statement/>
PREFIX pq: <https://metabase.wikibase.cloud/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX schema: <http://schema.org/>
"""


class HarvestError(RuntimeError):
    """The harvest cannot be completed; existing data files are left alone."""


def log(message: str = "") -> None:
    # Flushed so progress shows up in `toolforge jobs logs` while running.
    print(message, flush=True)


def values_clause(variable: str, item_ids: List[str]) -> str:
    return f"VALUES ?{variable} {{ " + " ".join(f"wb:{i}" for i in item_ids) + " }"


def label_service(*patterns: str) -> str:
    body = " ".join(f"{pattern} ." for pattern in patterns)
    return (
        "SERVICE wikibase:label { "
        f'bd:serviceParam wikibase:language "{",".join(LABEL_LANGUAGES)}" . {body} }}'
    )


def build_membership_query() -> str:
    """List every resource of a configured type, with its type(s)."""
    type_ids = list(RESOURCE_TYPES) + list(RESOURCE_TYPE_ALIASES)
    return f"""{PREFIXES}
SELECT ?resource ?resourceType
WHERE {{
  {values_clause("resourceType", type_ids)}
  ?resource wbt:P5 ?resourceType .
}}
"""


def build_detail_query(resource_ids: List[str]) -> str:
    """
    Fetch label, description and statements for one batch of resources.

    Each property is fetched in its own UNION branch, so a row carries the
    resource plus a single value and the row count is the *sum* of a
    resource's values. Joining the properties as OPTIONALs instead yields
    their cross product: a blog post translated into 21 languages has 21
    titles x 21 wiki pages x 21 languages = 9261 rows, which once made the
    blog post response over 100 MB.
    """
    resources = values_clause("resource", resource_ids)
    scalar_vars = " ".join(f"?{field}" for _, field in SCALAR_PROPERTIES)
    linked_vars = " ".join(f"?{var}" for _, var, _ in LINKED_PROPERTIES)
    branches = "\n".join(
        f"    UNION {{ ?resource wbt:{prop} ?{var} . }}"
        for prop, var in (
            list(SCALAR_PROPERTIES)
            + [(prop, var) for prop, var, _ in LINKED_PROPERTIES]
        )
    )
    return f"""{PREFIXES}
SELECT
  ?resource ?resourceLabel ?resourceDescription
  {scalar_vars}
  {linked_vars}
  ?tempAuthorValue ?event
WHERE {{
  {resources}
  {{
    # One row per resource with its label and description. Labelled in a
    # subquery so the label is not repeated on every property row.
    {{
      SELECT ?resource ?resourceLabel ?resourceDescription WHERE {{
        {resources}
        {label_service("?resource rdfs:label ?resourceLabel",
                       "?resource schema:description ?resourceDescription")}
      }}
    }}
{branches}
    UNION {{
      ?resource p:P38 ?tempAuthorStatement .
      ?tempAuthorStatement ps:P38 ?tempAuthorValue .
      ?tempAuthorStatement pq:P41 wb:P19 .
    }}
    # Event context: a resource is "used by" (P42) a conference session, which
    # may be "part of" (P17) another item zero or more times before reaching
    # the top-level item that is itself "instance of" (P5) a conference.
    UNION {{
      ?resource wbt:P42 ?usedBy .
      ?usedBy wbt:P17* ?event .
      ?event wbt:P5 wb:{EVENT_TYPE_ID} .
    }}
  }}
}}
"""


def build_label_query(item_ids: List[str]) -> str:
    """Fetch the display label for one batch of items."""
    return f"""{PREFIXES}
SELECT ?item ?itemLabel
WHERE {{
  {values_clause("item", item_ids)}
  {label_service("?item rdfs:label ?itemLabel")}
}}
"""


def retry_delay(response: Optional[requests.Response], attempt: int) -> float:
    """Seconds to wait before retrying: the server's Retry-After if given."""
    if response is not None:
        try:
            return min(float(response.headers.get("Retry-After", "")), MAX_RETRY_DELAY)
        except ValueError:
            pass
    return float(2 ** (attempt + 1))


class SparqlClient:
    """Runs queries one at a time, pausing between them and backing off on errors."""

    def __init__(
        self,
        session: requests.Session,
        *,
        endpoint: str,
        timeout: int,
        user_agent: str,
        max_retries: int,
        sleep: float,
        deadline: float,
    ) -> None:
        self.session = session
        self.endpoint = endpoint
        self.timeout = timeout
        self.max_retries = max_retries
        self.sleep = sleep
        self.deadline = deadline
        self.headers = {
            "Accept": "application/sparql-results+json",
            "User-Agent": user_agent,
        }
        self.request_count = 0

    def _wait(self, seconds: float) -> None:
        if time.monotonic() + seconds > self.deadline:
            raise HarvestError("Harvest exceeded its maximum runtime")
        time.sleep(seconds)

    def run(self, query: str) -> List[Dict[str, Any]]:
        """Return the result rows of a SPARQL query."""
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            # Pause before every request except the very first, so the
            # endpoint never sees back-to-back queries from us.
            if self.request_count:
                self._wait(self.sleep)
            self.request_count += 1

            response: Optional[requests.Response] = None
            try:
                # POST, because a batch of Q-IDs makes the query too long for
                # a URL.
                response = self.session.post(
                    self.endpoint,
                    data={"query": query},
                    headers=self.headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                return response.json()["results"]["bindings"]
            except (requests.RequestException, ValueError, KeyError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    self._wait(retry_delay(response, attempt))

        raise HarvestError(
            f"SPARQL request failed after {self.max_retries + 1} attempt(s): {last_error}"
        )


def value(binding: Dict[str, Any], key: str) -> str:
    """Return the string value of a SPARQL binding, or empty string if absent."""
    return binding.get(key, {}).get("value", "")


def known_value(binding: Dict[str, Any], key: str) -> str:
    """
    Like value(), but empty for Wikibase 'unknown value' snaks, which arrive
    as blank nodes (e.g. 't272913') rather than as real values.
    """
    if binding.get(key, {}).get("type") == "bnode":
        return ""
    return value(binding, key)


def item_id_from_uri(uri: str) -> str:
    """Extract the Q-ID from a Wikibase entity URI."""
    return uri.rstrip("/").split("/")[-1] if uri else ""


def batches(items: List[str], size: int) -> Iterator[List[str]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def is_real_date(raw: str) -> bool:
    """Return True only for genuine date strings like '+2021-01-01T00:00:00Z'."""
    return bool(raw) and (raw.startswith("+") or raw[:4].isdigit())


def wikimedia_page_url(wiki_page_value: str) -> str:
    """
    Build a meta.wikimedia.org URL from an interwiki-style P45 or P11 value
    such as ':wmse:Projekt:GLAM 2021/Wikimedia Commons guide'. Both
    properties share the formatter URL https://meta.wikimedia.org/wiki/$1.
    """
    if not wiki_page_value:
        return ""
    return "https://meta.wikimedia.org/wiki/" + quote(
        wiki_page_value.replace(" ", "_"), safe="/:_-"
    )


def youtube_url(video_id: str) -> str:
    """Build a youtube.com watch URL from a P59 YouTube video ID."""
    if not video_id:
        return ""
    return "https://www.youtube.com/watch?v=" + quote(video_id, safe="")


def get_primary_url(resource: Dict[str, Any]) -> str:
    """Return the most relevant external URL for a resource, or empty string."""
    if resource.get("courseUrl"):
        return resource["courseUrl"]
    if resource.get("commonsVideoPage"):
        return resource["commonsVideoPage"]
    if resource.get("commonsDocumentPage"):
        return resource["commonsDocumentPage"]
    if resource.get("youtubeId"):
        return youtube_url(resource["youtubeId"])
    if resource.get("wikiPage"):
        return wikimedia_page_url(resource["wikiPage"])
    if resource.get("describedAtPage"):
        return wikimedia_page_url(resource["describedAtPage"])
    return ""


def harvest_membership(client: SparqlClient) -> Dict[str, Set[str]]:
    """Return the canonical type IDs of every resource, keyed by resource ID."""
    types_by_resource: Dict[str, Set[str]] = {}
    for row in client.run(build_membership_query()):
        resource_id = item_id_from_uri(value(row, "resource"))
        type_id = item_id_from_uri(value(row, "resourceType"))
        if resource_id and type_id:
            types_by_resource.setdefault(resource_id, set()).add(canonical_type_id(type_id))
    return types_by_resource


def new_raw_record() -> Dict[str, Any]:
    """An empty holder for the values harvested for one resource."""
    record: Dict[str, Any] = {
        "label": "",
        "description": "",
        "titles": set(),  # (language code, text) pairs
        "tempAuthors": set(),
        "eventIds": set(),
    }
    for _, field in SCALAR_PROPERTIES:
        record[field] = set()
    for _, _, field in LINKED_PROPERTIES:
        record[field] = set()
    return record


def collect_rows(
    rows: List[Dict[str, Any]],
    raw_records: Dict[str, Dict[str, Any]],
) -> None:
    """Fold the rows of one detail query into the per-resource raw records."""
    for row in rows:
        record = raw_records.get(item_id_from_uri(value(row, "resource")))
        if record is None:
            continue

        record["label"] = record["label"] or value(row, "resourceLabel")
        record["description"] = record["description"] or value(row, "resourceDescription")

        if known_value(row, "titleProperty"):
            record["titles"].add(
                (row["titleProperty"].get("xml:lang", ""), value(row, "titleProperty"))
            )
        for _, field in SCALAR_PROPERTIES:
            if known_value(row, field):
                record[field].add(value(row, field))
        for _, var, field in LINKED_PROPERTIES:
            if known_value(row, var):
                record[field].add(item_id_from_uri(value(row, var)))
        if known_value(row, "tempAuthorValue"):
            record["tempAuthors"].add(value(row, "tempAuthorValue"))
        if known_value(row, "event"):
            record["eventIds"].add(item_id_from_uri(value(row, "event")))


def pick_title(titles: Set[Tuple[str, str]]) -> str:
    """
    Choose one title (P8) from a resource's titles: the first language in
    LABEL_LANGUAGES that has one, otherwise the first by language code.
    """
    def rank(title: Tuple[str, str]) -> Tuple[int, str, str]:
        language, text = title
        if language in LABEL_LANGUAGES:
            return (LABEL_LANGUAGES.index(language), language, text)
        return (len(LABEL_LANGUAGES), language, text)

    return min(titles, key=rank)[1] if titles else ""


def pick_first(values: Set[str]) -> str:
    """
    Choose one value where a single-valued property has several, so that the
    result is the same on every run. For Diff blog posts this happens to pick
    the original post (':diffblog:2016/…') over its translations
    (':diffblog:de/2016/…').
    """
    return min(values) if values else ""


def build_resource(
    resource_id: str,
    type_ids: Set[str],
    raw: Dict[str, Any],
    labels: Dict[str, str],
) -> Dict[str, Any]:
    """Turn the raw harvested values for one resource into its output record."""
    def linked_labels(item_ids: Set[str]) -> List[str]:
        return sorted({labels.get(item_id, item_id) for item_id in item_ids})

    resource: Dict[str, Any] = {
        "id":                  resource_id,
        "title":               raw["label"] or resource_id,
        "titleProperty":       pick_title(raw["titles"]),
        "wikidataId":          pick_first(raw["wikidataId"]),
        "description":         raw["description"],
        "typeIds":             sorted(
            type_ids,
            key=lambda type_id: RESOURCE_TYPES.get(type_id, {}).get("label", type_id),
        ),
        "publicationDate":     pick_first({d for d in raw["publicationDate"] if is_real_date(d)}),
        "courseUrl":           pick_first(raw["courseUrl"]),
        "commonsVideoPage":    pick_first(raw["commonsVideoPage"]),
        "commonsDocumentPage": pick_first(raw["commonsDocumentPage"]),
        "youtubeId":           pick_first(raw["youtubeId"]),
        "wikiPage":            pick_first(raw["wikiPage"]),
        "describedAtPage":     pick_first(raw["describedAtPage"]),
        "describedAtUrl":      pick_first(raw["describedAtUrl"]),
        "languages":           linked_labels(raw["languages"]),
        "subjects":            linked_labels(raw["subjects"]),
        "authors":             linked_labels(raw["authors"]),
        "publishers":          linked_labels(raw["publishers"]),
        "tempAuthors":         sorted(raw["tempAuthors"]),
        "events":              linked_labels(raw["eventIds"]),
        "eventIds":            sorted(raw["eventIds"]),
    }

    primary_url = get_primary_url(resource)
    resource["missing"] = {
        "title":           not bool(resource["titleProperty"]),
        "description":     not bool(resource["description"]),
        "mainSubject":     len(resource["subjects"]) == 0,
        "publisher":       len(resource["publishers"]) == 0,
        "publicationDate": not bool(resource["publicationDate"]),
        "language":        len(resource["languages"]) == 0,
        "externalLink":    not bool(primary_url or resource["describedAtUrl"]),
        "author":          len(resource["authors"]) == 0 or len(resource["tempAuthors"]) > 0,
        "event":           len(resource["events"]) == 0,
    }
    return resource


def build_metadata(resources: List[Dict[str, Any]], *, endpoint: str) -> Dict[str, Any]:
    type_counts:      Counter = Counter()
    language_counts:  Counter = Counter()
    subject_counts:   Counter = Counter()
    author_counts:    Counter = Counter()
    publisher_counts: Counter = Counter()
    event_counts:     Counter = Counter()
    missing_counts:   Counter = Counter()

    for r in resources:
        for t    in r.get("typeIds",    []): type_counts[t]      += 1
        for lang in r.get("languages",  []): language_counts[lang] += 1
        for subj in r.get("subjects",   []): subject_counts[subj]  += 1
        for auth in r.get("authors",    []): author_counts[auth]   += 1
        for pub  in r.get("publishers", []): publisher_counts[pub]  += 1
        for evt  in r.get("events",     []): event_counts[evt]     += 1
        for key, is_missing in r.get("missing", {}).items():
            if is_missing:
                missing_counts[key] += 1

    resource_type_metadata = {
        type_id: {
            "label":       RESOURCE_TYPES.get(type_id, {}).get("label", type_id),
            "pluralLabel": RESOURCE_TYPES.get(type_id, {}).get("pluralLabel", "resources"),
            "count":       count,
        }
        for type_id, count in type_counts.most_common()
    }

    return {
        "app":           APP_NAME,
        "schemaVersion": DATA_SCHEMA_VERSION,
        "generatedAt":   datetime.now(timezone.utc).isoformat(),
        "endpoint":      endpoint,
        "totalResources": len(resources),
        "configuredResourceTypes": len(RESOURCE_TYPES),
        # Always empty: a harvest is now written only if every query
        # succeeded. Kept because the front-end reads it.
        "failedResourceTypes": [],
        "authors":        dict(author_counts.most_common()),
        "resourceTypes":  resource_type_metadata,
        "languages":      dict(language_counts.most_common()),
        "subjects":       dict(subject_counts.most_common()),
        "publishers":     dict(publisher_counts.most_common()),
        "events":         dict(event_counts.most_common()),
        "missing":        dict(missing_counts),
    }


def previous_resource_count(metadata_path: Path) -> Optional[int]:
    """Return totalResources from the last successful harvest, if there is one."""
    try:
        count = json.loads(metadata_path.read_text(encoding="utf-8")).get("totalResources")
    except (OSError, ValueError, AttributeError):
        return None
    return count if isinstance(count, int) else None


def harvest(
    client: SparqlClient,
    *,
    batch_size: int,
    previous_count: Optional[int],
    max_drop: float,
) -> List[Dict[str, Any]]:
    """Run the full harvest and return the sorted output records."""
    log("Listing resources...")
    types_by_resource = harvest_membership(client)
    resource_ids = sorted(types_by_resource, key=lambda qid: int(qid[1:]))
    log(f"  {len(resource_ids)} resources")

    if not resource_ids:
        raise HarvestError("The endpoint returned no resources")
    if previous_count and len(resource_ids) < previous_count * (1 - max_drop):
        raise HarvestError(
            f"Found {len(resource_ids)} resources, down from {previous_count} in the "
            f"previous harvest. Assuming a problem with the endpoint; re-run with "
            f"--max-drop 1 if the drop is real."
        )

    raw_records = {resource_id: new_raw_record() for resource_id in resource_ids}
    batch_count = -(-len(resource_ids) // batch_size)
    for number, batch in enumerate(batches(resource_ids, batch_size), start=1):
        rows = client.run(build_detail_query(batch))
        collect_rows(rows, raw_records)
        log(f"Details: batch {number}/{batch_count} ({len(rows)} rows)")

    linked_ids = sorted(
        {
            item_id
            for raw in raw_records.values()
            for field in [field for _, _, field in LINKED_PROPERTIES] + ["eventIds"]
            for item_id in raw[field]
        },
        key=lambda qid: int(qid[1:]),
    )
    log(f"Fetching labels for {len(linked_ids)} linked items...")
    labels: Dict[str, str] = {}
    for batch in batches(linked_ids, batch_size):
        for row in client.run(build_label_query(batch)):
            labels[item_id_from_uri(value(row, "item"))] = value(row, "itemLabel")

    resources = [
        build_resource(resource_id, types_by_resource[resource_id], raw_records[resource_id], labels)
        for resource_id in resource_ids
    ]
    resources.sort(
        key=lambda r: (
            RESOURCE_TYPES.get(r["typeIds"][0], {}).get("label", r["typeIds"][0]),
            (r.get("title") or "").lower(),
        ),
    )
    return resources


def atomic_write_json(path: Path, data: Any, indent: Optional[int] = None) -> None:
    """Write JSON atomically via a temporary file to avoid partial writes."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Harvest resources from Metabase and write JSON."
    )
    parser.add_argument(
        "--output-dir", default="data",
        help="Directory for resources.json and metadata.json (default: data)",
    )
    parser.add_argument(
        "--sleep", type=float, default=0.5,
        help="Seconds to wait between SPARQL queries (default: 0.5)",
    )
    parser.add_argument(
        "--batch-size", type=int, default=500,
        help="Number of items to fetch per SPARQL query (default: 500)",
    )
    parser.add_argument(
        "--endpoint", default=ENDPOINT,
        help="SPARQL endpoint URL (default: Metabase Wikibase Cloud)",
    )
    parser.add_argument(
        "--timeout", type=int, default=120,
        help="HTTP timeout per SPARQL request, in seconds (default: 120)",
    )
    parser.add_argument(
        "--max-retries", type=int, default=2,
        help="Retry failed SPARQL requests this many times (default: 2)",
    )
    parser.add_argument(
        "--max-runtime", type=int, default=900,
        help="Give up if the harvest takes longer than this, in seconds (default: 900)",
    )
    parser.add_argument(
        "--max-drop", type=float, default=0.2,
        help="Abort if the number of resources fell by more than this fraction "
             "since the previous harvest (default: 0.2; 1 disables the check)",
    )
    parser.add_argument(
        "--user-agent", default=DEFAULT_USER_AGENT,
        help="HTTP User-Agent header sent to the SPARQL endpoint",
    )
    parser.add_argument(
        "--fail-on-error", action="store_true",
        help="No longer needed: a failed harvest always exits non-zero and "
             "leaves the existing files untouched. Accepted for compatibility.",
    )
    parser.add_argument(
        "--pretty", action="store_true",
        help="Indent JSON output (larger file, easier to read)",
    )
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    indent = 2 if args.pretty else None
    resources_path = output_dir / "resources.json"
    metadata_path  = output_dir / "metadata.json"

    try:
        with requests.Session() as session:
            client = SparqlClient(
                session,
                endpoint=args.endpoint,
                timeout=args.timeout,
                user_agent=args.user_agent,
                max_retries=args.max_retries,
                sleep=args.sleep,
                deadline=time.monotonic() + args.max_runtime,
            )
            resources = harvest(
                client,
                batch_size=args.batch_size,
                previous_count=previous_resource_count(metadata_path),
                max_drop=args.max_drop,
            )
    except HarvestError as exc:
        print(f"Harvest failed, keeping existing data files: {exc}", file=sys.stderr)
        return 1

    metadata = build_metadata(resources, endpoint=args.endpoint)
    atomic_write_json(resources_path, resources, indent)
    atomic_write_json(metadata_path,  metadata,  indent)

    log()
    log(f"Wrote {len(resources)} resources to {resources_path}")
    log(f"Wrote metadata to {metadata_path}")
    log(f"Generated at {metadata['generatedAt']} after {client.request_count} SPARQL requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
