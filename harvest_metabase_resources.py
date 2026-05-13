#!/usr/bin/env python3
"""
Harvest educational resources from Metabase Wikibase Cloud and save them as JSON.

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
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests


ENDPOINT = "https://metabase.wikibase.cloud/query/sparql"
APP_NAME = "MEOW"
DATA_SCHEMA_VERSION = 1
DEFAULT_USER_AGENT = "MEOWHarvester/1.0 (+https://metabase.wikibase.cloud/)"

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


def build_query(resource_type_id: str) -> str:
    return f"""
PREFIX wb: <https://metabase.wikibase.cloud/entity/>
PREFIX wbt: <https://metabase.wikibase.cloud/prop/direct/>
PREFIX p: <https://metabase.wikibase.cloud/prop/>
PREFIX ps: <https://metabase.wikibase.cloud/prop/statement/>
PREFIX pq: <https://metabase.wikibase.cloud/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX schema: <http://schema.org/>

SELECT
  ?resource ?resourceLabel ?resourceDescription
  ?resourceType ?resourceTypeLabel
  ?author ?authorLabel
  ?courseUrl ?commonsVideoPage ?commonsDocumentPage
  ?wikiPage ?publicationDate
  ?publisher ?publisherLabel
  ?language ?languageLabel
  ?mainSubject ?mainSubjectLabel
  ?tempAuthorValue
WHERE {{
  VALUES ?resourceType {{ wb:{resource_type_id} }}

  ?resource wbt:P5 ?resourceType .

  OPTIONAL {{ ?resource wbt:P44 ?courseUrl . }}
  OPTIONAL {{ ?resource wbt:P31 ?commonsVideoPage . }}
  OPTIONAL {{ ?resource wbt:P19 ?author . }}
  OPTIONAL {{ ?resource wbt:P22 ?commonsDocumentPage . }}
  OPTIONAL {{ ?resource wbt:P45 ?wikiPage . }}
  OPTIONAL {{ ?resource wbt:P18 ?publicationDate . }}
  OPTIONAL {{ ?resource wbt:P21 ?publisher . }}
  OPTIONAL {{ ?resource wbt:P20 ?language . }}
  OPTIONAL {{ ?resource wbt:P15 ?mainSubject . }}

  OPTIONAL {{
    ?resource p:P38 ?tempAuthorStatement .
    ?tempAuthorStatement ps:P38 ?tempAuthorValue .
    ?tempAuthorStatement pq:P41 wb:P19 .
  }}

  SERVICE wikibase:label {{
    bd:serviceParam wikibase:language "mul,en,de,it,es,pt,sr,bg,pl,sv" .
    ?resource     rdfs:label ?resourceLabel .
    ?resource     schema:description ?resourceDescription .
    ?resourceType rdfs:label ?resourceTypeLabel .
    ?publisher    rdfs:label ?publisherLabel .
    ?author       rdfs:label ?authorLabel .
    ?language     rdfs:label ?languageLabel .
    ?mainSubject  rdfs:label ?mainSubjectLabel .
  }}
}}
ORDER BY LCASE(STR(?resourceLabel))
"""


def run_sparql(
    query: str,
    *,
    endpoint: str,
    session: requests.Session,
    timeout: int,
    user_agent: str,
    max_retries: int,
) -> Dict[str, Any]:
    """Run a SPARQL query with small, explicit retry handling."""
    headers = {
        "Accept": "application/sparql-results+json",
        "User-Agent": user_agent,
    }

    last_error: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        try:
            response = session.get(
                endpoint,
                params={"query": query, "format": "json"},
                headers=headers,
                timeout=timeout,
            )
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt >= max_retries:
                break
            # Gentle exponential backoff. This protects the public endpoint and
            # makes transient network hiccups less likely to break a full harvest.
            time.sleep(2 ** attempt)

    raise RuntimeError(
        f"SPARQL request failed after {max_retries + 1} attempt(s): {last_error}"
    )


def value(binding: Dict[str, Any], key: str) -> str:
    """Return the string value of a SPARQL binding, or empty string if absent."""
    return binding.get(key, {}).get("value", "")


def item_id_from_uri(uri: str) -> str:
    """Extract the Q-ID from a Wikibase entity URI."""
    return uri.rstrip("/").split("/")[-1] if uri else ""


def add_unique(target: List[str], item: str) -> None:
    """Append item to target only if it is non-empty and not already present."""
    if item and item not in target:
        target.append(item)


def is_real_date(raw: str) -> bool:
    """
    Wikibase 'unknown value' snaks arrive as blank-node URIs (e.g. 't272913').
    Return True only for genuine date strings like '+2021-01-01T00:00:00Z'.
    """
    return bool(raw) and (raw.startswith("+") or raw[:4].isdigit())


def wikimedia_page_url(wiki_page_value: str) -> str:
    """
    Build a meta.wikimedia.org URL from an interwiki-style P45 value such as
    ':wmse:Projekt:GLAM 2021/Wikimedia Commons guide'.
    """
    if not wiki_page_value:
        return ""
    return "https://meta.wikimedia.org/wiki/" + quote(
        wiki_page_value.replace(" ", "_"), safe="/:_-"
    )


def get_primary_url(resource: Dict[str, Any]) -> str:
    """Return the most relevant external URL for a resource, or empty string."""
    if resource.get("courseUrl"):
        return resource["courseUrl"]
    if resource.get("commonsVideoPage"):
        return resource["commonsVideoPage"]
    if resource.get("commonsDocumentPage"):
        return resource["commonsDocumentPage"]
    if resource.get("wikiPage"):
        return wikimedia_page_url(resource["wikiPage"])
    return ""


def parse_rows(rows: List[Dict[str, Any]], resource_type_id: str) -> List[Dict[str, Any]]:
    """
    Collapse flat SPARQL result rows into one dict per resource, merging
    multi-valued properties (languages, authors, etc.) into lists.
    """
    by_id: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        resource_id = item_id_from_uri(value(row, "resource"))
        if not resource_id:
            continue

        type_id = item_id_from_uri(value(row, "resourceType")) or resource_type_id

        if resource_id not in by_id:
            raw_date = value(row, "publicationDate")
            by_id[resource_id] = {
                "id":                  resource_id,
                "title":               value(row, "resourceLabel") or resource_id,
                "description":         value(row, "resourceDescription"),
                "typeIds":             [type_id],
                "publicationDate":     raw_date if is_real_date(raw_date) else "",
                "courseUrl":           value(row, "courseUrl"),
                "commonsVideoPage":    value(row, "commonsVideoPage"),
                "commonsDocumentPage": value(row, "commonsDocumentPage"),
                "wikiPage":            value(row, "wikiPage"),
                "languages":           [],
                "subjects":            [],
                "authors":             [],
                "publishers":          [],
                "tempAuthors":         [],
            }

        resource = by_id[resource_id]

        add_unique(resource["typeIds"], type_id)

        # Fill in scalar fields from later rows if the first row had them empty.
        for field, key in (
            ("description",         "resourceDescription"),
            ("courseUrl",           "courseUrl"),
            ("commonsVideoPage",    "commonsVideoPage"),
            ("commonsDocumentPage", "commonsDocumentPage"),
            ("wikiPage",            "wikiPage"),
        ):
            if not resource.get(field):
                resource[field] = value(row, key)

        if not resource["publicationDate"]:
            raw_date = value(row, "publicationDate")
            if is_real_date(raw_date):
                resource["publicationDate"] = raw_date

        add_unique(resource["languages"],   value(row, "languageLabel"))
        add_unique(resource["subjects"],    value(row, "mainSubjectLabel"))
        add_unique(resource["authors"],     value(row, "authorLabel"))
        add_unique(resource["publishers"],  value(row, "publisherLabel"))
        add_unique(resource["tempAuthors"], value(row, "tempAuthorValue"))

    for resource in by_id.values():
        for lst in ("languages", "subjects", "publishers", "authors", "tempAuthors", "typeIds"):
            resource[lst].sort()

        primary_url = get_primary_url(resource)
        resource["missing"] = {
            "description":     not bool(resource["description"]),
            "mainSubject":     len(resource["subjects"]) == 0,
            "publisher":       len(resource["publishers"]) == 0,
            "publicationDate": not bool(resource["publicationDate"]),
            "language":        len(resource["languages"]) == 0,
            "externalLink":    not bool(primary_url),
            "unlinkedAuthor":  len(resource["tempAuthors"]) > 0,
        }

    return list(by_id.values())


def merge_into(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    """
    Merge a resource from a second type query into an existing record.
    Only typeIds need merging — all other fields should already be the same.
    """
    for type_id in source["typeIds"]:
        add_unique(target["typeIds"], type_id)


def build_metadata(
    resources: List[Dict[str, Any]],
    *,
    endpoint: str,
    failed_resource_types: List[str],
) -> Dict[str, Any]:
    type_counts:      Counter = Counter()
    language_counts:  Counter = Counter()
    subject_counts:   Counter = Counter()
    author_counts:    Counter = Counter()
    publisher_counts: Counter = Counter()
    missing_counts:   Counter = Counter()

    for r in resources:
        for t    in r.get("typeIds",    []): type_counts[t]      += 1
        for lang in r.get("languages",  []): language_counts[lang] += 1
        for subj in r.get("subjects",   []): subject_counts[subj]  += 1
        for auth in r.get("authors",    []): author_counts[auth]   += 1
        for pub  in r.get("publishers", []): publisher_counts[pub]  += 1
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
        "failedResourceTypes": failed_resource_types,
        "authors":        dict(author_counts.most_common()),
        "resourceTypes":  resource_type_metadata,
        "languages":      dict(language_counts.most_common()),
        "subjects":       dict(subject_counts.most_common()),
        "publishers":     dict(publisher_counts.most_common()),
        "missing":        dict(missing_counts),
    }


def harvest_resource_type(
    resource_type_id: str,
    *,
    endpoint: str,
    session: requests.Session,
    timeout: int,
    user_agent: str,
    max_retries: int,
) -> List[Dict[str, Any]]:
    """Harvest and normalise one configured resource type."""
    label = RESOURCE_TYPES.get(resource_type_id, {}).get("label", resource_type_id)
    print(f"Harvesting {label} ({resource_type_id})...")

    rows = run_sparql(
        build_query(resource_type_id),
        endpoint=endpoint,
        session=session,
        timeout=timeout,
        user_agent=user_agent,
        max_retries=max_retries,
    ).get("results", {}).get("bindings", [])
    resources = parse_rows(rows, resource_type_id)

    print(f"  {len(rows)} rows → {len(resources)} resources")
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
        "--user-agent", default=DEFAULT_USER_AGENT,
        help="HTTP User-Agent header sent to the SPARQL endpoint",
    )
    parser.add_argument(
        "--fail-on-error", action="store_true",
        help="Exit with a non-zero status if any resource type fails",
    )
    parser.add_argument(
        "--pretty", action="store_true",
        help="Indent JSON output (larger file, easier to read)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    indent = 2 if args.pretty else None

    all_resources: Dict[str, Dict[str, Any]] = {}
    failed_resource_types: List[str] = []

    with requests.Session() as session:
        for resource_type_id in RESOURCE_TYPES:
            try:
                for resource in harvest_resource_type(
                    resource_type_id,
                    endpoint=args.endpoint,
                    session=session,
                    timeout=args.timeout,
                    user_agent=args.user_agent,
                    max_retries=args.max_retries,
                ):
                    rid = resource["id"]
                    if rid in all_resources:
                        # Same resource appeared under a second type — merge the
                        # new typeId rather than overwriting the existing record.
                        merge_into(all_resources[rid], resource)
                    else:
                        all_resources[rid] = resource
                time.sleep(args.sleep)
            except Exception as e:
                failed_resource_types.append(resource_type_id)
                print(f"Error for {resource_type_id}: {e}", file=sys.stderr)

    for resource in all_resources.values():
        resource["typeIds"].sort(
            key=lambda type_id: RESOURCE_TYPES.get(type_id, {}).get("label", type_id)
        )

    resources = sorted(
        all_resources.values(),
        key=lambda r: (
            RESOURCE_TYPES.get(r["typeIds"][0], {}).get("label", r["typeIds"][0]),
            (r.get("title") or "").lower(),
        ),
    )

    metadata = build_metadata(
        resources,
        endpoint=args.endpoint,
        failed_resource_types=failed_resource_types,
    )

    resources_path = output_dir / "resources.json"
    metadata_path  = output_dir / "metadata.json"
    atomic_write_json(resources_path, resources, indent)
    atomic_write_json(metadata_path,  metadata,  indent)

    print()
    print(f"Wrote {len(resources)} resources to {resources_path}")
    print(f"Wrote metadata to {metadata_path}")
    print(f"Generated at {metadata['generatedAt']}")
    if failed_resource_types:
        print("Failed resource types: " + ", ".join(failed_resource_types), file=sys.stderr)
        if args.fail_on_error:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
