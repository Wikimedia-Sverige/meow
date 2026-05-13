# MEOW

**MEOW** - **Metabase Educational Open Works** - is a web app for exploring educational resources described in [Metabase](https://metabase.wikibase.cloud/), a database of resources and events by the Wikimedia Movement.

The app collects resource metadata from Metabase and presents it as a searchable, filterable catalogue of Wikimedia-related educational materials, such as guides, tutorials, videos, reports, slide decks, manuals, courses, case studies, and other open learning resources.

MEOW is developed by [Wikimedia Sverige](https://wikimedia.se/).

## Live version

MEOW is available at:

<https://meow.toolforge.org/>

## What MEOW does

MEOW helps users discover educational resources by allowing them to:

- search resource titles and descriptions
- filter by resource type
- filter by language
- filter by publication year
- filter by publisher
- filter by author
- browse and filter by keywords
- identify resources with missing metadata
- export filtered results as CSV
- share filtered views through URL parameters

The app is designed to make educational materials in the Wikimedia ecosystem easier to find, reuse, improve, and connect.

## Data source

The data comes from [Metabase](https://metabase.wikibase.cloud/), a Wikibase Cloud instance used to describe Wikimedia-related resources and organizations.

The harvester queries the Metabase SPARQL endpoint and creates local JSON files used by the front-end:

```text
data/resources.json
data/metadata.json