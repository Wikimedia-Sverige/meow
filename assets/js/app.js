/* global $ */
"use strict";

// Resource type labels — still needed client-side for CSV export
// filenames, result-count labels, and badge rendering.
var resourceTypes = {
  Q43: { label: "Application", pluralLabel: "applications" },
  Q53: { label: "Annual report", pluralLabel: "annual reports" },
  Q55: { label: "Audit report", pluralLabel: "audit reports" },
  Q44583: { label: "Article", pluralLabel: "articles" },
  Q22266: { label: "Budget", pluralLabel: "budgets" },
  Q23237: { label: "Blog post", pluralLabel: "blog posts" },
  Q23367: { label: "Brochure", pluralLabel: "brochures" },
  Q22136: { label: "Case study", pluralLabel: "case studies" },
  Q25288: { label: "Conference paper", pluralLabel: "conference papers" },
  Q50361: { label: "Conference proceedings", pluralLabel: "conference proceedings" },
  Q21996: { label: "Fail fest", pluralLabel: "fail fests" },
  Q54: { label: "Financial statement", pluralLabel: "financial statements" },
  Q25817: { label: "Grant proposal", pluralLabel: "grant proposals" },
  Q21954: { label: "Guide", pluralLabel: "guides" },
  Q23360: { label: "Guideline", pluralLabel: "guidelines" },
  Q31862: { label: "Handbook", pluralLabel: "handbooks" },
  Q23351: { label: "How-to", pluralLabel: "how-tos" },
  Q24134: { label: "Manual", pluralLabel: "manuals" },
  Q57: { label: "Minutes", pluralLabel: "minutes" },
  Q45501: { label: "Online course", pluralLabel: "online courses" },
  Q36499: { label: "Operational plan", pluralLabel: "operational plans" },
  Q44: { label: "Poster", pluralLabel: "posters" },
  Q23235: { label: "Podcast episode", pluralLabel: "podcast episodes" },
  Q2: { label: "Project", pluralLabel: "projects" },
  Q29: { label: "Report", pluralLabel: "reports" },
  Q23251: { label: "Scholarly article", pluralLabel: "scholarly articles" },
  Q62: { label: "Slide deck", pluralLabel: "slide decks" },
  Q21993: { label: "Story", pluralLabel: "stories" },
  Q36469: { label: "Strategic plan", pluralLabel: "strategic plans" },
  Q23276: { label: "Tutorial", pluralLabel: "tutorials" },
  Q21950: { label: "Video", pluralLabel: "videos" },
  Q45522: { label: "Video tutorial", pluralLabel: "video tutorials" },
  Q23258: { label: "Wikibooks book", pluralLabel: "Wikibooks books" },
  Q23260: { label: "Wikiversity course", pluralLabel: "Wikiversity courses" },
  Q47: { label: "White paper", pluralLabel: "white papers" },
  Q76: { label: "Final report", pluralLabel: "final reports" },
};

// Page size must match the server-side PAGE_SIZE constant in app.py.
var PAGE_SIZE = 48;

// Cached metadata from /api/metadata (populated by loadMetadata).
var _metadata = null;

// Cached facets from the most recent /api/resources response.
// Used to rebuild filter panels on local search-within-panel changes
// without a new API call.
var _lastFacets = {};

// Monotonically increasing request counter used to discard stale responses
// when the user changes filters faster than responses arrive.
var _renderRequestId = 0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var state = {
  search: "",
  types: [],
  language: "",
  year: "",
  subjects: [],
  subjectSearch: "",
  publisherSearch: "",
  publishers: [],
  authorSearch: "",
  authors: [],
  eventSearch: "",
  events: [],
  maintenance: {
    missingTitle: false,
    missingDescription: false,
    missingSubject: false,
    missingLanguage: false,
    missingPublicationDate: false,
    missingAuthors: false
  },
  sort: "id-desc",
  page: 1,
  view: "grid"
};

// ---------------------------------------------------------------------------
// URL state — read, write, sync
// ---------------------------------------------------------------------------

function readStateFromUrl() {
  var params = new URLSearchParams(location.search);

  state.search   = params.get("q")    || "";
  state.types    = params.getAll("type");
  state.language = params.get("lang") || "";
  state.year     = params.get("year") || "";
  state.subjects = params.getAll("subject");
  state.publishers = params.getAll("publisher");
  state.authors  = params.getAll("author");
  state.events   = params.getAll("event");

  var missingStr   = params.get("missing") || "";
  var missingFlags = missingStr ? missingStr.split(",") : [];
  state.maintenance.missingTitle           = missingFlags.indexOf("title")          !== -1;
  state.maintenance.missingDescription     = missingFlags.indexOf("description")    !== -1;
  state.maintenance.missingSubject         = missingFlags.indexOf("subject")        !== -1;
  state.maintenance.missingLanguage        = missingFlags.indexOf("language")       !== -1;
  state.maintenance.missingPublicationDate = missingFlags.indexOf("pubdate")        !== -1;
  state.maintenance.missingAuthors         = missingFlags.indexOf("author")         !== -1;

  var sort = params.get("sort");
  if (sort === "id") { sort = "id-asc"; }
  state.sort = sort || "id-desc";

  var page = parseInt(params.get("page"), 10);
  state.page = (page && page > 0) ? page : 1;

  var view = params.get("view");
  state.view = (view === "list") ? "list" : "grid";

  state.subjectSearch   = "";
  state.publisherSearch = "";
  state.authorSearch    = "";
  state.eventSearch     = "";
}

function buildUrlParams() {
  var params = new URLSearchParams();

  if (state.search)   params.set("q",    state.search);
  if (state.language) params.set("lang", state.language);
  if (state.year)     params.set("year", state.year);
  $.each(state.subjects,   function (i, s) { params.append("subject",   s); });
  $.each(state.types,      function (i, t) { params.append("type",      t); });
  $.each(state.publishers, function (i, p) { params.append("publisher", p); });
  $.each(state.authors,    function (i, a) { params.append("author",    a); });
  $.each(state.events,     function (i, e) { params.append("event",     e); });

  var missingFlags = [];
  if (state.maintenance.missingTitle)           missingFlags.push("title");
  if (state.maintenance.missingDescription)     missingFlags.push("description");
  if (state.maintenance.missingSubject)         missingFlags.push("subject");
  if (state.maintenance.missingLanguage)        missingFlags.push("language");
  if (state.maintenance.missingPublicationDate) missingFlags.push("pubdate");
  if (state.maintenance.missingAuthors)         missingFlags.push("author");
  if (missingFlags.length) params.set("missing", missingFlags.join(","));

  if (state.sort && state.sort !== "id-desc") params.set("sort", state.sort);
  if (state.page && state.page > 1)           params.set("page", state.page);
  if (state.view === "list")                  params.set("view", "list");

  return params;
}

function replaceUrlState() {
  var params = buildUrlParams();
  var search = params.toString();
  var newUrl = search ? location.pathname + "?" + search : location.pathname;
  history.replaceState({ meow: true }, "", newUrl);
}

function syncUiToState() {
  $("#searchInput").val(state.search);
  $("#languageFilter").val(state.language);
  $("#sortSelect").val(state.sort);
  $("#missingTitleFilter").prop("checked",            state.maintenance.missingTitle);
  $("#missingDescriptionFilter").prop("checked",      state.maintenance.missingDescription);
  $("#missingSubjectFilter").prop("checked",          state.maintenance.missingSubject);
  $("#missingLanguageFilter").prop("checked",         state.maintenance.missingLanguage);
  $("#missingPublicationDateFilter").prop("checked",  state.maintenance.missingPublicationDate);
  $("#missingAuthorsFilter").prop("checked",          state.maintenance.missingAuthors);
  updateImproveDataCount();
  $("#viewGrid").attr("aria-pressed", state.view === "grid").toggleClass("is-active", state.view === "grid");
  $("#viewList").attr("aria-pressed", state.view === "list").toggleClass("is-active", state.view === "list");
  $("#subjectSearchInput").val("");
  $("#publisherSearchInput").val("");
  $("#authorSearchInput").val("");
  $("#eventSearchInput").val("");
}

// ---------------------------------------------------------------------------
// Copy-link button
// ---------------------------------------------------------------------------

function initCopyLinkButton() {
  $("#copyLinkButton").on("click", function () {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function () { showCopied(); })
        .catch(function () { legacyCopy(url); });
    } else {
      legacyCopy(url);
    }
  });
}

function legacyCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity  = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showCopied();
  } finally {
    document.body.removeChild(ta);
  }
}

function showCopied() {
  var $btn = $("#copyLinkButton");
  $btn.text("✓ Copied").addClass("copy-link-button--copied");
  setTimeout(function () {
    $btn.text("Copy link").removeClass("copy-link-button--copied");
  }, 2200);
}

// ---------------------------------------------------------------------------
// CSV export — fetches all filtered results from the server
// ---------------------------------------------------------------------------

function initExportCsvButton() {
  $("#exportCsvButton").on("click", function () {
    exportCsv();
  });
}

function exportCsv() {
  var $btn = $("#exportCsvButton");
  $btn.prop("disabled", true).text("Exporting…");

  // Build params but request all results (no pagination).
  var params = buildUrlParams();
  params.set("all", "1");
  params.delete("page");
  params.delete("view");

  $.getJSON("/api/resources?" + params.toString())
    .done(function (data) {
      var filtered = normalizeResources(data.results);

      var columns = [
        "id", "title", "type", "description",
        "publication_date", "publication_month_year",
        "languages", "keywords", "publishers", "authors",
        "temp_authors", "events", "primary_url", "metabase_url"
      ];

      var rows = [columns.map(csvQuote).join(",")];

      $.each(filtered, function (i, r) {
        var row = [
          r.id, r.title, r.typeLabel, r.description,
          r.publicationDate, r.publicationMonthYear,
          r.languages.join(" | "),
          r.subjects.join(" | "),
          r.publishers.join(" | "),
          r.authors.join(" | "),
          (r.tempAuthors || []).join(" | "),
          r.events.join(" | "),
          r.primaryUrl, r.metabaseUrl
        ].map(csvQuote).join(",");
        rows.push(row);
      });

      var csv      = rows.join("\r\n");
      var bom      = "\uFEFF";
      var blob     = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
      var url      = URL.createObjectURL(blob);
      var filename = buildExportFilename();

      var a    = document.createElement("a");
      a.href     = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

      $btn.prop("disabled", false).text("Export CSV");
    })
    .fail(function () {
      alert("Export failed. Please try again.");
      $btn.prop("disabled", false).text("Export CSV");
    });
}

function csvQuote(value) {
  var str = (value === null || value === undefined) ? "" : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

function buildExportFilename() {
  var parts = ["meow-export"];
  if (state.types.length === 1 && resourceTypes[state.types[0]]) {
    parts.push(slugify(resourceTypes[state.types[0]].pluralLabel));
  }
  var today = new Date();
  parts.push(
    today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0")
  );
  return parts.join("-") + ".csv";
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

function initViewToggle() {
  $("#viewGrid").on("click", function () {
    if (state.view === "grid") { return; }
    state.view = "grid";
    syncUiToState();
    render();
  });
  $("#viewList").on("click", function () {
    if (state.view === "list") { return; }
    state.view = "list";
    syncUiToState();
    render();
  });
}

// ---------------------------------------------------------------------------
// Navigation modals (About / Contribute)
// ---------------------------------------------------------------------------

function initNavMenu() {
  $("#navAbout").on("click", function () {
    $("#aboutModal").prop("hidden", false);
    $("body").addClass("modal-open");
    $("#aboutModal .modal-close").focus();
  });
  $("#closeAboutModal").on("click", function () {
    $("#aboutModal").prop("hidden", true);
    $("body").removeClass("modal-open");
    $("#navAbout").focus();
  });
  $("#aboutModal").on("click", function (e) {
    if (e.target === this) {
      $("#aboutModal").prop("hidden", true);
      $("body").removeClass("modal-open");
    }
  });

  $("#navContribute").on("click", function () {
    $("#contributeModal").prop("hidden", false);
    $("body").addClass("modal-open");
    $("#contributeModal .modal-close").focus();
  });
  $("#closeContributeModal").on("click", function () {
    $("#contributeModal").prop("hidden", true);
    $("body").removeClass("modal-open");
    $("#navContribute").focus();
  });
  $("#contributeModal").on("click", function (e) {
    if (e.target === this) {
      $("#contributeModal").prop("hidden", true);
      $("body").removeClass("modal-open");
    }
  });

  $(document).on("keydown.navModals", function (e) {
    if (e.key !== "Escape") { return; }
    if (!$("#aboutModal").prop("hidden")) {
      $("#aboutModal").prop("hidden", true);
      $("body").removeClass("modal-open");
      $("#navAbout").focus();
    }
    if (!$("#contributeModal").prop("hidden")) {
      $("#contributeModal").prop("hidden", true);
      $("body").removeClass("modal-open");
      $("#navContribute").focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Title reset
// ---------------------------------------------------------------------------

function initTitleReset() {
  $("#brandTitle")
    .on("click", function () { clearAllFilters(); })
    .on("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        clearAllFilters();
      }
    })
    .attr("title", "Reset to default view")
    .attr("role", "button")
    .attr("tabindex", "0")
    .attr("aria-label", "Reset MEOW to the default view");
}

// ---------------------------------------------------------------------------
// Jump to top
// ---------------------------------------------------------------------------

function initJumpToTop() {
  var $btn = $("#jumpToTop");
  $(window).on("scroll.jumpToTop", function () {
    $btn.toggleClass("is-visible", $(window).scrollTop() > 300);
  });
  $btn.on("click", function () {
    $("html, body").animate({ scrollTop: 0 }, 220);
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

$(function () {
  readStateFromUrl();

  // Search (debounced — avoids hammering the server on every keystroke)
  var _searchDebounce = null;
  $("#searchInput").on("input", function () {
    state.search = $(this).val().trim().toLowerCase();
    state.page = 1;
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(render, 300);
  });

  // Panel search inputs — local filter of cached facets, no API call
  $("#publisherSearchInput").on("input", function () {
    state.publisherSearch = $(this).val().trim().toLowerCase();
    buildPublisherFilters(_lastFacets);
  });
  $("#authorSearchInput").on("input", function () {
    state.authorSearch = $(this).val().trim().toLowerCase();
    buildAuthorFilters(_lastFacets);
  });
  $("#subjectSearchInput").on("input", function () {
    state.subjectSearch = $(this).val().trim().toLowerCase();
    buildSubjectPanel(_lastFacets);
  });
  $("#eventSearchInput").on("input", function () {
    state.eventSearch = $(this).val().trim().toLowerCase();
    buildEventFilters(_lastFacets);
  });

  $("#clearSearch").on("click", function () { clearAllFilters(); });

  $("#languageFilter").on("change", function () {
    state.language = $(this).val();
    state.page = 1;
    render();
  });

  $("#sortSelect").on("change", function () {
    state.sort = $(this).val();
    state.page = 1;
    render();
  });

  $("#missingTitleFilter").on("change", function () {
    state.maintenance.missingTitle = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });
  $("#missingDescriptionFilter").on("change", function () {
    state.maintenance.missingDescription = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });
  $("#missingSubjectFilter").on("change", function () {
    state.maintenance.missingSubject = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });
  $("#missingLanguageFilter").on("change", function () {
    state.maintenance.missingLanguage = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });
  $("#missingPublicationDateFilter").on("change", function () {
    state.maintenance.missingPublicationDate = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });
  $("#missingAuthorsFilter").on("change", function () {
    state.maintenance.missingAuthors = $(this).is(":checked");
    state.page = 1;
    updateImproveDataCount();
    render();
  });

  $("#resetFilters").on("click", function () { clearAllFilters(); });

  $("#closeLanguageInsights").on("click", function () { closeLanguageInsights(); });
  $("#closeKeywordInsights").on("click",  function () { closeKeywordInsights(); });
  $("#languageInsightsModal").on("click", function (e) {
    if (e.target === this) { closeLanguageInsights(); }
  });
  $("#keywordInsightsModal").on("click", function (e) {
    if (e.target === this) { closeKeywordInsights(); }
  });
  $(document).on("keydown", function (e) {
    if (e.key === "Escape") {
      closeLanguageInsights();
      closeKeywordInsights();
    }
  });

  $(window).on("popstate", function () {
    readStateFromUrl();
    syncUiToState();
    render();
  });

  initCopyLinkButton();
  initExportCsvButton();
  initViewToggle();
  initNavMenu();
  initTitleReset();
  initJumpToTop();

  // Load metadata (header timestamp, summary stats, insights) and
  // kick off the first data request in parallel.
  loadMetadata();
  render();
});

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function clearAllFilters() {
  state.search = "";
  state.types  = [];
  state.language = "";
  state.year   = "";
  state.subjects = [];
  state.subjectSearch = "";
  state.publisherSearch = "";
  state.authorSearch = "";
  state.eventSearch = "";
  state.publishers = [];
  state.authors = [];
  state.events = [];
  state.maintenance.missingTitle          = false;
  state.maintenance.missingDescription    = false;
  state.maintenance.missingSubject        = false;
  state.maintenance.missingLanguage       = false;
  state.maintenance.missingPublicationDate = false;
  state.maintenance.missingAuthors        = false;
  state.page = 1;

  syncUiToState();
  render();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadMetadata() {
  $.getJSON("/api/metadata")
    .done(function (data) {
      _metadata = data;

      // Header timestamp
      var note = "Data last updated: unknown";
      if (data.generatedAt) {
        var date = new Date(data.generatedAt);
        if (!isNaN(date.getTime())) {
          note = "Data last updated: " + date.toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit"
          });
        }
      }
      if (data.failedResourceTypes && data.failedResourceTypes.length) {
        note += " · partial harvest";
      }
      $("#dataUpdatedAt").text(note);

      // Summary stats are ready as soon as metadata arrives
      renderSummaryStats();
    })
    .fail(function () {
      $("#dataUpdatedAt").text("Data last updated: unknown");
    });
}

// ---------------------------------------------------------------------------
// Normalisation — called on each page of API results
// ---------------------------------------------------------------------------

function normalizeResources(data) {
  var normalized = [];
  $.each(data, function (i, resource) {
    var id                  = resource.id || "";
    var typeIds             = resource.typeIds || (resource.typeId ? [resource.typeId] : []);
    var courseUrl           = resource.courseUrl || "";
    var commonsVideoPage    = normalizeCommonsFilePageUrl(resource.commonsVideoPage    || "");
    var commonsDocumentPage = normalizeCommonsFilePageUrl(resource.commonsDocumentPage || "");
    var youtubeUrl          = getYoutubeUrl(resource.youtubeId);
    var wikiPageUrl         = getWikimediaPageUrl(resource.wikiPage);
    var describedAtPageUrl  = getWikimediaPageUrl(resource.describedAtPage);
    var describedAtUrl      = resource.describedAtUrl || "";
    var wikidataUrl         = getWikidataUrl(resource.wikidataId);
    var primaryUrl          = courseUrl || commonsVideoPage || commonsDocumentPage || youtubeUrl || wikiPageUrl || describedAtPageUrl;

    normalized.push({
      id:                   id,
      typeIds:              typeIds,
      typeId:               typeIds[0] || "",
      typeLabel:            typeIds.map(function (t) { return getResourceTypeLabel(t); }).join(", "),
      title:                resource.title || id || "",
      description:          resource.description || "",
      publicationDate:      resource.publicationDate || "",
      publicationMonthYear: formatMonthYear(resource.publicationDate),
      courseUrl:            courseUrl,
      commonsVideoPage:     commonsVideoPage,
      commonsDocumentPage:  commonsDocumentPage,
      youtubeId:            resource.youtubeId || "",
      youtubeUrl:           youtubeUrl,
      wikiPage:             resource.wikiPage || "",
      wikiPageUrl:          wikiPageUrl,
      describedAtPage:      resource.describedAtPage || "",
      describedAtPageUrl:   describedAtPageUrl,
      describedAtUrl:       describedAtUrl,
      wikidataId:           resource.wikidataId || "",
      wikidataUrl:          wikidataUrl,
      metabaseUrl:          "https://metabase.wikibase.cloud/wiki/Item:" + id,
      primaryUrl:           primaryUrl,
      primaryUrlLabel:      "",
      publishers:           resource.publishers || [],
      languages:            resource.languages  || [],
      authors:              resource.authors    || [],
      subjects:             resource.subjects   || [],
      tempAuthors:          resource.tempAuthors || [],
      events:               resource.events     || [],
      eventIds:             resource.eventIds   || [],
      missing: {
        title:           hasMissing(resource, "title",           !resource.titleProperty),
        description:     hasMissing(resource, "description",    !resource.description),
        mainSubject:     hasMissing(resource, "mainSubject",    !(resource.subjects   && resource.subjects.length)),
        publisher:       hasMissing(resource, "publisher",      !(resource.publishers && resource.publishers.length)),
        publicationDate: hasMissing(resource, "publicationDate", !resource.publicationDate),
        language:        hasMissing(resource, "language",       !(resource.languages  && resource.languages.length)),
        externalLink:    hasMissing(resource, "externalLink",   !primaryUrl && !describedAtUrl),
        author:          hasMissing(resource, "author",         !(resource.authors && resource.authors.length) || !!(resource.tempAuthors && resource.tempAuthors.length)),
        event:           hasMissing(resource, "event",          !(resource.events && resource.events.length))
      }
    });
  });
  return normalized;
}

function hasMissing(resource, key, fallback) {
  if (resource.missing && typeof resource.missing[key] !== "undefined") {
    return resource.missing[key];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Filter panel builders — receive facet counts from the API response
// ---------------------------------------------------------------------------

function buildResourceTypeFilter(facets) {
  var typeCounts = (facets && facets.types) || {};
  var foundTypes = Object.keys(typeCounts);

  foundTypes.sort(function (a, b) {
    return getResourceTypeLabel(a).localeCompare(getResourceTypeLabel(b));
  });

  setCollapsibleCount("#resourceTypeCount", state.types.length, foundTypes.length);

  if (!foundTypes.length) {
    $("#resourceTypeFilters").html('<p class="filter-empty">No resource types found.</p>');
    return;
  }

  var html = "";
  $.each(foundTypes, function (i, typeId) {
    var activeClass = state.types.indexOf(typeId) !== -1 ? " is-active" : "";
    html += '<button type="button" class="resource-type-filter-button' + activeClass + '" data-type-id="' + escapeAttribute(typeId) + '">';
    html += '<span class="resource-type-filter-name">' + escapeHtml(getResourceTypeLabel(typeId)) + "</span>";
    html += '<span class="resource-type-filter-count">' + typeCounts[typeId] + "</span>";
    html += "</button>";
  });

  $("#resourceTypeFilters").html(html);
  $(".resource-type-filter-button").on("click", function () {
    toggleTypeFilter($(this).data("type-id"));
  });
}

function buildLanguageFilter(facets) {
  var langCounts = (facets && facets.languages) || {};
  var languages  = Object.keys(langCounts);

  languages.sort(function (a, b) {
    if (langCounts[b] !== langCounts[a]) { return langCounts[b] - langCounts[a]; }
    return a.localeCompare(b);
  });

  var html = '<option value="">All languages</option>';
  $.each(languages, function (i, language) {
    html += '<option value="' + escapeAttribute(language) + '"';
    if (state.language === language) { html += " selected"; }
    html += ">" + escapeHtml(language) + " (" + langCounts[language] + ")</option>";
  });

  $("#languageFilter").html(html);
}

function buildYearFilter(facets) {
  var yearCounts = (facets && facets.years)      || {};
  var noDate     = (facets && facets.yearNoDate) || 0;
  var years      = Object.keys(yearCounts).sort();

  setCollapsibleCount("#yearFilterCount", state.year ? 1 : 0, years.length);

  if (!years.length) {
    $("#yearFilters").html('<p class="filter-empty">No publication dates found.</p>');
    return;
  }

  var maxCount = 0;
  $.each(years, function (i, y) { if (yearCounts[y] > maxCount) { maxCount = yearCounts[y]; } });

  var html = "";
  $.each(years, function (i, year) {
    var pct    = maxCount ? Math.round((yearCounts[year] / maxCount) * 100) : 0;
    var active = state.year === year;
    html += '<button type="button" class="year-bar-button' + (active ? " is-active" : "") + '" data-year="' + escapeAttribute(year) + '">';
    html += '<span class="year-bar-label">'  + escapeHtml(year) + "</span>";
    html += '<span class="year-bar-track"><span class="year-bar-fill" style="width:' + pct + '%"></span></span>';
    html += '<span class="year-bar-count">' + yearCounts[year] + "</span>";
    html += "</button>";
  });

  if (noDate) {
    html += '<p class="year-no-date">No date: ' + noDate + "</p>";
  }

  $("#yearFilters").html(html);
  $(".year-bar-button").on("click", function () {
    var year = $(this).attr("data-year");
    state.year = (state.year === year) ? "" : year;
    state.page = 1;
    render();
  });
}

function buildPublisherFilters(facets) {
  var publisherCounts = (facets && facets.publishers) || {};
  var publishers      = Object.keys(publisherCounts);

  publishers.sort(function (a, b) {
    if (publisherCounts[b] !== publisherCounts[a]) { return publisherCounts[b] - publisherCounts[a]; }
    return a.localeCompare(b);
  });

  if (state.publisherSearch) {
    publishers = publishers.filter(function (p) {
      return p.toLowerCase().indexOf(state.publisherSearch) !== -1;
    });
  }

  setCollapsibleCount("#publisherCount", state.publishers.length, publishers.length);

  if (!publishers.length) {
    $("#publisherFilters").html('<p class="filter-empty">No publishers found.</p>');
    return;
  }

  var html = "";
  $.each(publishers, function (i, publisher) {
    var activeClass = state.publishers.indexOf(publisher) !== -1 ? " is-active" : "";
    html += '<button type="button" class="publisher-filter-button' + activeClass + '" data-publisher="' + escapeAttribute(publisher) + '">';
    html += '<span class="publisher-filter-name">' + escapeHtml(publisher) + "</span>";
    html += '<span class="publisher-filter-count">' + publisherCounts[publisher] + "</span>";
    html += "</button>";
  });

  $("#publisherFilters").html(html);
  $(".publisher-filter-button").on("click", function () {
    togglePublisherFilter($(this).data("publisher"));
  });
}

function buildAuthorFilters(facets) {
  var authorCounts = (facets && facets.authors) || {};
  var authors      = Object.keys(authorCounts);

  authors.sort(function (a, b) {
    if (authorCounts[b] !== authorCounts[a]) { return authorCounts[b] - authorCounts[a]; }
    return a.localeCompare(b);
  });

  if (state.authorSearch) {
    authors = authors.filter(function (a) {
      return a.toLowerCase().indexOf(state.authorSearch) !== -1;
    });
  }

  setCollapsibleCount("#authorCount", state.authors.length, authors.length);

  if (!authors.length) {
    $("#authorFilters").html('<p class="filter-empty">No authors found.</p>');
    return;
  }

  var html = "";
  $.each(authors, function (i, author) {
    var activeClass = state.authors.indexOf(author) !== -1 ? " is-active" : "";
    html += '<button type="button" class="author-filter-button' + activeClass + '" data-author="' + escapeAttribute(author) + '">';
    html += '<span class="author-filter-name">' + escapeHtml(author) + "</span>";
    html += '<span class="author-filter-count">' + authorCounts[author] + "</span>";
    html += "</button>";
  });

  $("#authorFilters").html(html);
  $(".author-filter-button").on("click", function () {
    toggleAuthorFilter($(this).data("author"));
  });
}

function buildEventFilters(facets) {
  var eventCounts = (facets && facets.events) || {};
  var events      = Object.keys(eventCounts);

  events.sort(function (a, b) {
    if (eventCounts[b] !== eventCounts[a]) { return eventCounts[b] - eventCounts[a]; }
    return a.localeCompare(b);
  });

  if (state.eventSearch) {
    events = events.filter(function (e) {
      return e.toLowerCase().indexOf(state.eventSearch) !== -1;
    });
  }

  setCollapsibleCount("#eventCount", state.events.length, events.length);

  if (!events.length) {
    $("#eventFilters").html('<p class="filter-empty">No events found.</p>');
    return;
  }

  var html = "";
  $.each(events, function (i, evt) {
    var activeClass = state.events.indexOf(evt) !== -1 ? " is-active" : "";
    html += '<button type="button" class="event-filter-button' + activeClass + '" data-event="' + escapeAttribute(evt) + '">';
    html += '<span class="event-filter-name">' + escapeHtml(evt) + "</span>";
    html += '<span class="event-filter-count">' + eventCounts[evt] + "</span>";
    html += "</button>";
  });

  $("#eventFilters").html(html);
  $(".event-filter-button").on("click", function () {
    toggleEventFilter($(this).data("event"));
  });
}

function setCollapsibleCount(selector, activeCount, shownCount) {
  var text = shownCount + " shown";
  if (activeCount) {
    text = activeCount + " active · " + text;
    $(selector).addClass("has-active");
  } else {
    $(selector).removeClass("has-active");
  }
  $(selector).text(text);
}

function updateImproveDataCount() {
  var active = 0;
  $.each(state.maintenance, function (key, isOn) { if (isOn) { active++; } });

  var $count = $("#improveDataCount");
  if (active) {
    $count.text(active + " active").addClass("has-active");
  } else {
    $count.text("").removeClass("has-active");
  }
}

function buildSubjectPanel(facets) {
  var subjectCounts = (facets && facets.subjects) || {};
  var subjects      = Object.keys(subjectCounts);

  subjects.sort(function (a, b) {
    if (subjectCounts[b] !== subjectCounts[a]) { return subjectCounts[b] - subjectCounts[a]; }
    return a.localeCompare(b);
  });

  if (state.subjectSearch) {
    subjects = subjects.filter(function (s) {
      return s.toLowerCase().indexOf(state.subjectSearch) !== -1;
    });
  }

  setCollapsibleCount("#subjectCount", state.subjects.length, subjects.length);

  if (!subjects.length) {
    $("#subjectFilters").html('<p class="filter-empty">No subjects found.</p>');
    return;
  }

  var html = "";
  $.each(subjects, function (i, subject) {
    var activeClass = state.subjects.indexOf(subject) !== -1 ? " is-active" : "";
    html += '<button type="button" class="subject-filter-button' + activeClass + '" data-subject="' + escapeAttribute(subject) + '">';
    html += '<span class="subject-filter-name">' + escapeHtml(subject) + "</span>";
    html += '<span class="subject-filter-count">' + subjectCounts[subject] + "</span>";
    html += "</button>";
  });

  $("#subjectFilters").html(html);
  $(".subject-filter-button").on("click", function () {
    toggleSubjectFilter($(this).data("subject"));
  });
}

// ---------------------------------------------------------------------------
// Main render — async, calls the API
// ---------------------------------------------------------------------------

function render() {
  var requestId = ++_renderRequestId;

  // Immediately update the URL and show loading state.
  replaceUrlState();
  $("#resultCount").text("Loading resources…");
  $("#results").attr("aria-busy", "true");

  var params = buildUrlParams();
  params.delete("view");  // view is a UI-only param, not an API param

  $.getJSON("/api/resources?" + params.toString())
    .done(function (data) {
      // Discard responses to superseded requests.
      if (requestId !== _renderRequestId) { return; }

      _lastFacets = data.facets;

      // Update page from server (in case it was clamped).
      state.page = data.page;

      // Unlock export now that the server is reachable.
      $("#exportCsvButton").prop("disabled", false);

      // Rebuild all filter panels from fresh facet counts.
      buildResourceTypeFilter(data.facets);
      buildLanguageFilter(data.facets);
      buildYearFilter(data.facets);
      buildPublisherFilters(data.facets);
      buildAuthorFilters(data.facets);
      buildEventFilters(data.facets);
      buildSubjectPanel(data.facets);

      // Active filter strip above results
      renderActiveFilters();

      // Result count label
      var from = (data.page - 1) * data.pageSize + 1;
      var to   = Math.min(data.page * data.pageSize, data.total);
      $("#resultCount").text(getResultCountText(data.total, from, to));

      if (!data.total) {
        $("#results")
          .attr("aria-busy", "false")
          .removeClass("card-grid card-list")
          .html('<div class="empty-state">No resources found. Try another search term, language, subject, publisher, author or resource type.</div>');
        $("#pagination").empty();
        return;
      }

      var pageItems = normalizeResources(data.results);
      var html = (state.view === "list")
        ? renderListItems(pageItems)
        : renderCardItems(pageItems);

      $("#results")
        .attr("aria-busy", "false")
        .removeClass("card-grid card-list")
        .addClass(state.view === "list" ? "card-list" : "card-grid")
        .html(html);

      bindResultEvents();
      renderPagination(data.total, data.totalPages);
    })
    .fail(function (xhr, status, error) {
      if (requestId !== _renderRequestId) { return; }

      $("#resultCount").text("Could not load resources");
      $("#results").attr("aria-busy", "false").empty();
      $("#statusMessage").html(
        '<div class="error-state">' +
        "<strong>Could not load resources.</strong><br>" +
        "Make sure the MEOW server is running." +
        "</div>"
      );
      console.error("API error:", status, error);
    });
}

// ---------------------------------------------------------------------------
// Item renderers (unchanged from original)
// ---------------------------------------------------------------------------

function renderBadges(resource, context) {
  var html = "";
  if (context === "list") {
    $.each(resource.typeIds, function (k, typeId) {
      var typeActive = state.types.indexOf(typeId) !== -1 ? " is-active" : "";
      html += '<button type="button" class="row-type-label' + typeActive + '" data-type-id="' + escapeAttribute(typeId) + '">';
      html += escapeHtml(getResourceTypeLabel(typeId));
      html += "</button>";
    });
    $.each(resource.languages, function (j, language) {
      var langActive = state.language === language ? " is-active" : "";
      html += '<button type="button" class="row-lang-label badge--language' + langActive + '" data-language="' + escapeAttribute(language) + '">' + escapeHtml(language) + "</button>";
    });
    return html;
  }
  $.each(resource.typeIds, function (k, typeId) {
    var typeActiveG = state.types.indexOf(typeId) !== -1 ? " is-active" : "";
    html += '<button type="button" class="badge badge--clickable badge--type' + typeActiveG + '" data-type-id="' + escapeAttribute(typeId) + '">';
    html += escapeHtml(getResourceTypeLabel(typeId));
    html += "</button>";
  });
  $.each(resource.languages, function (j, language) {
    var langActive = state.language === language ? " is-active" : "";
    html += '<button type="button" class="badge badge--clickable badge--language' + langActive + '" data-language="' + escapeAttribute(language) + '">';
    html += escapeHtml(language);
    html += "</button>";
  });
  return html;
}

function renderPublishers(resource) {
  if (!resource.publishers.length) { return ""; }
  var html = '<p class="resource-publisher">';
  html += '<span class="resource-publisher-label" title="Publisher">🏛️</span> ';
  $.each(resource.publishers, function (j, publisher) {
    var activeClass = state.publishers.indexOf(publisher) !== -1 ? " is-active" : "";
    if (j > 0) { html += " "; }
    html += '<button type="button" class="publisher-link' + activeClass + '" data-publisher="' + escapeAttribute(publisher) + '">';
    html += escapeHtml(publisher);
    html += "</button>";
    if (j < resource.publishers.length - 1) { html += ","; }
  });
  return html + "</p>";
}

function renderAuthors(resource) {
  if (!resource.authors.length) { return ""; }
  var html = '<p class="resource-author">';
  html += '<span class="resource-author-label" title="Author">✍️</span> ';
  $.each(resource.authors, function (j, author) {
    var activeClass = state.authors.indexOf(author) !== -1 ? " is-active" : "";
    if (j > 0) { html += " "; }
    html += '<button type="button" class="author-link' + activeClass + '" data-author="' + escapeAttribute(author) + '">';
    html += escapeHtml(author);
    html += "</button>";
    if (j < resource.authors.length - 1) { html += ","; }
  });
  return html + "</p>";
}

function renderEvents(resource) {
  if (!resource.events || !resource.events.length) { return ""; }
  var html = '<p class="resource-event">';
  html += '<span class="resource-event-label" title="Event">🎤</span> ';
  $.each(resource.events, function (j, evt) {
    var activeClass = state.events.indexOf(evt) !== -1 ? " is-active" : "";
    if (j > 0) { html += " "; }
    html += '<button type="button" class="event-link' + activeClass + '" data-event="' + escapeAttribute(evt) + '">';
    html += escapeHtml(evt);
    html += "</button>";
    if (j < resource.events.length - 1) { html += ","; }
  });
  return html + "</p>";
}

function renderTempAuthors(resource) {
  if (!resource.tempAuthors || !resource.tempAuthors.length) { return ""; }
  var html = '<p class="resource-temp-author">';
  html += '<span class="resource-temp-author-label" title="Undisambiguated author string. Needs to be linked to a Metabase item">✍️</span> ';
  $.each(resource.tempAuthors, function (j, author) {
    if (j > 0) { html += ", "; }
    html += '<em class="temp-author-value">' + escapeHtml(author) + "</em>";
  });
  return html + "</p>";
}

function renderSubjectTags(resource) {
  if (!resource.subjects.length) { return ""; }
  var html = '<div class="subject-tags">';
  $.each(resource.subjects, function (j, subject) {
    var activeClass = state.subjects.indexOf(subject) !== -1 ? " is-active" : "";
    html += '<button type="button" class="subject-tag' + activeClass + '" data-subject="' + escapeAttribute(subject) + '">';
    html += escapeHtml(subject);
    html += "</button>";
  });
  return html + "</div>";
}

// A single external-link glyph used for every resource link, so the button
// always looks the same regardless of where it points (course, Commons,
// Wikimedia page). The destination is conveyed via the tooltip/aria-label.
var LINK_ICON_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M6.5 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5C2 13.216 2.784 14 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M9 2h5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M14 2 7.5 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

function linkIconButton(url, label) {
  return '<a class="link-icon-button" href="' + escapeAttribute(url) + '" target="_blank" rel="noopener" title="' + escapeAttribute(label) + '" aria-label="' + escapeAttribute(label) + '">' + LINK_ICON_SVG + "</a>";
}

function renderLinkIcons(resource) {
  var html = "";
  if (resource.courseUrl) {
    html += linkIconButton(resource.courseUrl, getPrimaryLinkLabel(resource));
  }
  if (resource.commonsVideoPage) {
    html += linkIconButton(resource.commonsVideoPage, "Open video on Commons");
  }
  if (resource.commonsDocumentPage) {
    html += linkIconButton(resource.commonsDocumentPage, "Open on Commons");
  }
  if (resource.youtubeUrl) {
    html += linkIconButton(resource.youtubeUrl, "Open on YouTube");
  }
  if (resource.wikiPageUrl) {
    html += linkIconButton(resource.wikiPageUrl, "Open Wikimedia page");
  }
  if (resource.describedAtPageUrl) {
    html += linkIconButton(resource.describedAtPageUrl, "Open Wikimedia page");
  }
  if (resource.describedAtUrl) {
    html += linkIconButton(resource.describedAtUrl, "Open external page");
  }
  return html;
}

// A small, quiet secondary link — Wikidata is a cross-reference, not the
// resource's primary link, so it's styled to recede rather than compete
// with the main link-icon-button(s).
function renderWikidataLink(resource) {
  if (!resource.wikidataUrl) { return ""; }
  return '<a class="wikidata-link-button" href="' + escapeAttribute(resource.wikidataUrl) + '" target="_blank" rel="noopener" title="View on Wikidata" aria-label="View on Wikidata">WD</a>';
}

function renderCardItems(pageItems) {
  var html = "";
  $.each(pageItems, function (i, resource) {
    var formattedDate = resource.publicationMonthYear;
    html += '<article class="resource-card">';
    html += '<div class="card-meta">';
    html += '<div class="card-badges">';
    html += renderBadges(resource, "grid");
    html += '<span class="badge">' + escapeHtml(resource.id) + "</span>";
    html += "</div>";
    var cardLinkIcons = renderLinkIcons(resource) + renderWikidataLink(resource);
    if (cardLinkIcons) {
      html += '<div class="card-link-icons">' + cardLinkIcons + "</div>";
    }
    html += "</div>";
    html += "<h2>";
    html += '<a class="resource-title-link" href="' + escapeAttribute(resource.metabaseUrl) + '" target="_blank" rel="noopener">';
    html += escapeHtml(resource.title);
    html += "</a></h2>";
    if (resource.description) {
      html += '<p class="description">' + escapeHtml(resource.description) + "</p>";
    } else {
      html += '<p class="description description--empty">No description available.</p>';
    }
    if (formattedDate) {
      html += '<p class="resource-date" title="Publication date">📅 ' + escapeHtml(formattedDate) + "</p>";
    }
    html += renderPublishers(resource);
    html += renderAuthors(resource);
    html += renderEvents(resource);
    html += renderTempAuthors(resource);
    html += renderSubjectTags(resource);
    html += "</article>";
  });
  return html;
}

function renderListItems(pageItems) {
  var html = "";
  $.each(pageItems, function (i, resource) {
    var formattedDate = resource.publicationMonthYear;
    html += '<article class="resource-row">';
    html += '<div class="row-badges">';
    html += renderBadges(resource, "list");
    html += "</div>";
    html += '<div class="row-body">';
    html += '<h3 class="row-title">';
    html += '<a class="resource-title-link" href="' + escapeAttribute(resource.metabaseUrl) + '" target="_blank" rel="noopener">';
    html += escapeHtml(resource.title);
    html += "</a></h3>";
    if (resource.description) {
      html += '<p class="description row-description">' + escapeHtml(resource.description) + "</p>";
    }
    var metaParts = [];
    if (formattedDate) {
      metaParts.push('<span class="row-meta-date">📅 ' + escapeHtml(formattedDate) + "</span>");
    }
    if (resource.publishers.length || resource.authors.length) {
      metaParts.push(renderPublishers(resource) + renderAuthors(resource));
    }
    if (resource.events.length) {
      metaParts.push(renderEvents(resource));
    }
    if (metaParts.length) {
      html += '<div class="row-meta">' + metaParts.join('<span class="row-meta-sep">·</span>') + "</div>";
    }
    html += renderTempAuthors(resource);
    html += renderSubjectTags(resource);
    html += "</div>";
    html += '<div class="row-actions">';
    var rowLinkIcons = renderLinkIcons(resource) + renderWikidataLink(resource);
    if (rowLinkIcons) {
      html += '<div class="row-links">' + rowLinkIcons + "</div>";
    }
    html += '<span class="badge row-id-badge">' + escapeHtml(resource.id) + "</span>";
    html += "</div>";
    html += "</article>";
  });
  return html;
}

function bindResultEvents() {
  $(".badge--type, .row-type-label").on("click", function () {
    toggleTypeFilter($(this).data("type-id"));
  });
  $(".badge--language, .row-lang-label").on("click", function () {
    var language = $(this).data("language");
    state.language = (state.language === language) ? "" : language;
    state.page = 1;
    $("#languageFilter").val(state.language);
    render();
  });
  $(".subject-tag").on("click", function () {
    toggleSubjectFilter($(this).data("subject"));
  });
  $(".publisher-link").on("click", function () {
    togglePublisherFilter($(this).data("publisher"));
  });
  $(".author-link").on("click", function () {
    toggleAuthorFilter($(this).data("author"));
  });
  $(".event-link").on("click", function () {
    toggleEventFilter($(this).data("event"));
  });
}

// ---------------------------------------------------------------------------
// Toggle helpers
// ---------------------------------------------------------------------------

function toggleTypeFilter(typeId) {
  if (state.types.indexOf(typeId) === -1) {
    state.types.push(typeId);
  } else {
    state.types = state.types.filter(function (item) { return item !== typeId; });
  }
  state.page = 1;
  syncTypeFilters();
  render();
}

function syncTypeFilters() {
  $(".resource-type-filter-button").each(function () {
    $(this).toggleClass("is-active", state.types.indexOf($(this).data("type-id")) !== -1);
  });
}

function toggleSubjectFilter(subject) {
  if (state.subjects.indexOf(subject) === -1) {
    state.subjects.push(subject);
  } else {
    state.subjects = state.subjects.filter(function (item) { return item !== subject; });
  }
  state.page = 1;
  render();
}

function togglePublisherFilter(publisher) {
  if (state.publishers.indexOf(publisher) === -1) {
    state.publishers.push(publisher);
  } else {
    state.publishers = state.publishers.filter(function (item) { return item !== publisher; });
  }
  state.page = 1;
  syncPublisherFilters();
  render();
}

function toggleAuthorFilter(author) {
  if (state.authors.indexOf(author) === -1) {
    state.authors.push(author);
  } else {
    state.authors = state.authors.filter(function (item) { return item !== author; });
  }
  state.page = 1;
  syncAuthorFilters();
  render();
}

function toggleEventFilter(evt) {
  if (state.events.indexOf(evt) === -1) {
    state.events.push(evt);
  } else {
    state.events = state.events.filter(function (item) { return item !== evt; });
  }
  state.page = 1;
  syncEventFilters();
  render();
}

// Provide immediate visual feedback before the API response arrives.
function syncPublisherFilters() {
  $(".publisher-filter-button").each(function () {
    $(this).toggleClass("is-active", state.publishers.indexOf($(this).data("publisher")) !== -1);
  });
}

function syncAuthorFilters() {
  $(".author-filter-button").each(function () {
    $(this).toggleClass("is-active", state.authors.indexOf($(this).data("author")) !== -1);
  });
}

function syncEventFilters() {
  $(".event-filter-button").each(function () {
    $(this).toggleClass("is-active", state.events.indexOf($(this).data("event")) !== -1);
  });
}

// ---------------------------------------------------------------------------
// Summary stats (uses cached metadata, not live resource list)
// ---------------------------------------------------------------------------

function renderSummaryStats() {
  if (!_metadata) { return; }

  var stats = {
    resources:     _metadata.totalResources || 0,
    resourceTypes: Object.keys(_metadata.resourceTypes || {}).length,
    languages:     Object.keys(_metadata.languages || {}).length,
    subjects:      Object.keys(_metadata.subjects  || {}).length,
    publishers:    Object.keys(_metadata.publishers || {}).length,
    authors:       Object.keys(_metadata.authors   || {}).length
  };

  var html = "";
  html += '<div class="summary-stat">';
  html += '<span class="summary-stat-number">' + stats.resources    + "</span>";
  html += '<span class="summary-stat-label">Resources</span>';
  html += "</div>";

  html += '<div class="summary-stat">';
  html += '<span class="summary-stat-number">' + stats.resourceTypes + "</span>";
  html += '<span class="summary-stat-label">Types</span>';
  html += "</div>";

  html += '<button type="button" id="languageInsightsButton" class="summary-stat summary-stat-button">';
  html += '<span class="summary-stat-number">' + stats.languages + "</span>";
  html += '<span class="summary-stat-label">Languages</span>';
  html += '<span class="summary-stat-hint">View insights →</span>';
  html += "</button>";

  html += '<button type="button" id="keywordInsightsButton" class="summary-stat summary-stat-button">';
  html += '<span class="summary-stat-number">' + stats.subjects + "</span>";
  html += '<span class="summary-stat-label">Keywords</span>';
  html += '<span class="summary-stat-hint">View insights →</span>';
  html += "</button>";

  html += '<div class="summary-stat">';
  html += '<span class="summary-stat-number">' + stats.publishers  + "</span>";
  html += '<span class="summary-stat-label">Publishers</span>';
  html += "</div>";

  html += '<div class="summary-stat">';
  html += '<span class="summary-stat-number">' + stats.authors     + "</span>";
  html += '<span class="summary-stat-label">Authors</span>';
  html += "</div>";

  $("#summaryStats").html(html);
  $("#languageInsightsButton").on("click", function () { openLanguageInsights(); });
  $("#keywordInsightsButton").on("click",  function () { openKeywordInsights(); });
}

// ---------------------------------------------------------------------------
// Active filter strip
// ---------------------------------------------------------------------------

function renderActiveFilters() {
  var hasTypes      = state.types.length > 0;
  var hasYear       = !!state.year;
  var hasSubjects   = state.subjects.length > 0;
  var hasPublishers = state.publishers.length > 0;
  var hasAuthors    = state.authors.length > 0;
  var hasEvents     = state.events.length > 0;
  var hasMaint      =
    state.maintenance.missingTitle          ||
    state.maintenance.missingDescription    ||
    state.maintenance.missingSubject        ||
    state.maintenance.missingLanguage       ||
    state.maintenance.missingPublicationDate ||
    state.maintenance.missingAuthors;

  if (!hasTypes && !hasYear && !hasSubjects && !hasPublishers && !hasAuthors && !hasEvents && !hasMaint) {
    $("#activeFilters").empty();
    return;
  }

  var html = '<div class="active-filter-strip">';

  if (hasTypes) {
    var typeLabels = state.types.map(function (t) { return getResourceTypeLabel(t); });
    html += "<span>Type: <strong>" + escapeHtml(typeLabels.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-type-filter">Clear types</button>';
  }
  if (hasYear) {
    html += "<span>Year: <strong>" + escapeHtml(state.year) + "</strong></span>";
    html += '<button type="button" class="clear-year-filter">Clear year</button>';
  }
  if (hasSubjects) {
    html += '<span class="active-filter-label">Keyword:</span>';
    $.each(state.subjects, function (i, subject) {
      html += '<button type="button" class="active-filter-chip remove-subject-chip" data-subject="' + escapeAttribute(subject) + '">';
      html += escapeHtml(subject) + ' <span aria-hidden="true">×</span>';
      html += "</button>";
    });
  }
  if (hasPublishers) {
    html += "<span>Publisher: <strong>" + escapeHtml(state.publishers.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-publisher-filter">Clear publisher</button>';
  }
  if (hasAuthors) {
    html += "<span>Author: <strong>" + escapeHtml(state.authors.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-author-filter">Clear author</button>';
  }
  if (hasEvents) {
    html += "<span>Event: <strong>" + escapeHtml(state.events.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-event-filter">Clear event</button>';
  }
  if (hasMaint) {
    var labels = [];
    if (state.maintenance.missingTitle)           { labels.push("missing title"); }
    if (state.maintenance.missingDescription)     { labels.push("missing description"); }
    if (state.maintenance.missingSubject)         { labels.push("missing keyword"); }
    if (state.maintenance.missingLanguage)        { labels.push("missing language"); }
    if (state.maintenance.missingPublicationDate) { labels.push("missing publication date"); }
    if (state.maintenance.missingAuthors)         { labels.push("missing authors"); }
    html += "<span>Improve data: <strong>" + escapeHtml(labels.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-maintenance-filter">Clear improve data</button>';
  }

  html += "</div>";
  $("#activeFilters").html(html);

  $(".clear-type-filter").on("click", function () {
    state.types = []; state.page = 1; syncTypeFilters(); render();
  });
  $(".clear-year-filter").on("click", function () {
    state.year = ""; state.page = 1; render();
  });
  $(".remove-subject-chip").on("click", function () {
    var subject = $(this).data("subject");
    state.subjects = state.subjects.filter(function (s) { return s !== subject; });
    state.page = 1; render();
  });
  $(".clear-publisher-filter").on("click", function () {
    state.publishers = []; state.page = 1; syncPublisherFilters(); render();
  });
  $(".clear-author-filter").on("click", function () {
    state.authors = []; state.page = 1; syncAuthorFilters(); render();
  });
  $(".clear-event-filter").on("click", function () {
    state.events = []; state.page = 1; syncEventFilters(); render();
  });
  $(".clear-maintenance-filter").on("click", function () {
    state.maintenance.missingTitle          = false;
    state.maintenance.missingDescription    = false;
    state.maintenance.missingSubject        = false;
    state.maintenance.missingLanguage       = false;
    state.maintenance.missingPublicationDate = false;
    state.maintenance.missingAuthors        = false;
    state.page = 1;
    $("#missingTitleFilter").prop("checked",           false);
    $("#missingDescriptionFilter").prop("checked",     false);
    $("#missingSubjectFilter").prop("checked",         false);
    $("#missingLanguageFilter").prop("checked",        false);
    $("#missingPublicationDateFilter").prop("checked", false);
    $("#missingAuthorsFilter").prop("checked",         false);
    updateImproveDataCount();
    render();
  });
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function getResultCountText(total, from, to) {
  var label = "resources";
  if (state.types.length === 1 && resourceTypes[state.types[0]]) {
    label = resourceTypes[state.types[0]].pluralLabel;
  }
  if (total <= PAGE_SIZE) { return total + " " + label; }
  return from + "–" + to + " of " + total + " " + label;
}

function renderPagination(total, totalPages) {
  var $el = $("#pagination");

  if (totalPages <= 1) { $el.empty(); return; }

  var current  = state.page;
  var pageNums = getPageNumbers(current, totalPages);
  var html     = "";

  html += '<button type="button" class="pagination-button pagination-prev"';
  if (current === 1) { html += ' disabled aria-disabled="true"'; }
  html += ' aria-label="Previous page">← Prev</button>';

  $.each(pageNums, function (i, num) {
    if (num === "...") {
      html += '<span class="pagination-ellipsis" aria-hidden="true">…</span>';
    } else {
      html += '<button type="button" class="pagination-button pagination-number';
      if (num === current) { html += " is-current"; }
      html += '" data-page="' + num + '"';
      if (num === current) { html += ' aria-current="page"'; }
      html += ' aria-label="Page ' + num + '">' + num + "</button>";
    }
  });

  html += '<button type="button" class="pagination-button pagination-next"';
  if (current === totalPages) { html += ' disabled aria-disabled="true"'; }
  html += ' aria-label="Next page">Next →</button>';

  $el.html(html);

  $(".pagination-prev").on("click", function () {
    if (state.page > 1) { state.page -= 1; scrollToResults(); render(); }
  });
  $(".pagination-next").on("click", function () {
    if (state.page < totalPages) { state.page += 1; scrollToResults(); render(); }
  });
  $(".pagination-number").on("click", function () {
    var target = parseInt($(this).data("page"), 10);
    if (target !== state.page) { state.page = target; scrollToResults(); render(); }
  });
}

function getPageNumbers(current, total) {
  var WING = 2;
  if (total <= 2 * WING + 5) {
    var all = [];
    for (var p = 1; p <= total; p++) { all.push(p); }
    return all;
  }
  var rangeStart = Math.max(2, current - WING);
  var rangeEnd   = Math.min(total - 1, current + WING);
  var pages      = [1];
  if (rangeStart > 2) { pages.push("..."); }
  for (var i = rangeStart; i <= rangeEnd; i++) { pages.push(i); }
  if (rangeEnd < total - 1) { pages.push("..."); }
  pages.push(total);
  return pages;
}

function scrollToResults() {
  var $results = $("#results");
  if (!$results.length) { return; }
  var offset  = $results.offset().top - 20;
  var current = $(window).scrollTop();
  if (current > offset) {
    $("html, body").animate({ scrollTop: offset }, 180);
  }
}

// ---------------------------------------------------------------------------
// Label / text helpers
// ---------------------------------------------------------------------------

function getPrimaryLinkLabel(resource) {
  if (resource.courseUrl) {
    if (resource.typeId === "Q45501" || resource.typeId === "Q23260") { return "Open course"; }
    if (resource.typeId === "Q23258") { return "Open book"; }
    return "Open resource";
  }
  if (resource.commonsVideoPage)    { return "Open video on Commons"; }
  if (resource.commonsDocumentPage) { return "Open on Commons"; }
  if (resource.wikiPageUrl)         { return "Open Wikimedia page"; }
  if (resource.describedAtPageUrl)  { return "Open Wikimedia page"; }
  return "Open resource";
}

function getResourceTypeLabel(typeId) {
  return resourceTypes[typeId] ? resourceTypes[typeId].label : typeId;
}

// ---------------------------------------------------------------------------
// Language insights modal — uses pre-computed data from /api/metadata
// ---------------------------------------------------------------------------

function openLanguageInsights() {
  renderLanguageInsights();
  $("#languageInsightsModal").prop("hidden", false);
  $("body").addClass("modal-open");
}

function closeLanguageInsights() {
  $("#languageInsightsModal").prop("hidden", true);
  $("body").removeClass("modal-open");
}

function getLanguageInsights() {
  var li    = (_metadata && _metadata.insights && _metadata.insights.languages) || {};
  var total = (_metadata && _metadata.totalResources) || 0;
  var unique = Object.keys((_metadata && _metadata.languages) || {}).length;

  return {
    totalResources:        total,
    uniqueLanguages:       unique,
    resourcesWithLanguage: li.withLanguage    || 0,
    missingLanguage:       li.missingLanguage || 0,
    topLanguages:          li.topLanguages    || [],
    rareLanguages:         li.rareLanguages   || [],
    maxLanguageCount:      li.maxCount        || 0,
    diversity: [
      { label: "Monolingual",      count: li.monolingual    || 0, note: "resources with exactly one language" },
      { label: "Bilingual",        count: li.bilingual      || 0, note: "resources with two languages" },
      { label: "Multilingual",     count: li.multilingual   || 0, note: "resources with three or more languages" },
      { label: "Missing language", count: li.missingLanguage || 0, note: "resources without language data" }
    ]
  };
}

function renderLanguageInsights() {
  var insights = getLanguageInsights();
  var html     = "";

  html += '<div class="language-overview-grid">';
  html += renderLanguageOverviewCard(insights.uniqueLanguages,       "Languages",        "unique languages in the dataset");
  html += renderLanguageOverviewCard(insights.resourcesWithLanguage, "Tagged resources", "resources with at least one language");
  html += renderLanguageOverviewCard(insights.missingLanguage,       "Missing language", "resources needing language data");
  html += "</div>";

  if (insights.missingLanguage > 0) {
    html += '<div class="language-action-strip">';
    html += "<span>There are resources without language data.</span>";
    html += '<button type="button" class="language-missing-button">Show resources missing language</button>';
    html += "</div>";
  }

  html += '<div class="language-insight-section">';
  html += '<div class="section-heading-row">';
  html += "<div><h3>Top languages</h3><p>Click a language to filter the resource list.</p></div>";
  html += "<p>" + insights.topLanguages.length + " shown</p>";
  html += "</div>";
  html += '<div class="language-bar-list">';

  $.each(insights.topLanguages, function (i, item) {
    var width = insights.maxLanguageCount
      ? Math.round((item.count / insights.maxLanguageCount) * 100)
      : 0;
    html += '<button type="button" class="language-bar-button" data-language="' + escapeAttribute(item.language) + '">';
    html += '<span class="language-bar-label">' + escapeHtml(item.language) + "</span>";
    html += '<span class="language-bar-track"><span class="language-bar-fill" style="width: ' + width + '%"></span></span>';
    html += '<span class="language-bar-count">' + item.count + "</span>";
    html += "</button>";
  });

  html += "</div></div>";
  html += '<div class="language-insight-grid">';
  html += '<div class="language-insight-section">';
  html += "<h3>Language diversity</h3>";
  html += '<div class="diversity-list">';

  $.each(insights.diversity, function (i, item) {
    var width = insights.totalResources
      ? Math.round((item.count / insights.totalResources) * 100)
      : 0;
    html += '<div class="diversity-row">';
    html += '<div class="diversity-row-top"><span>' + escapeHtml(item.label) + "</span><strong>" + item.count + "</strong></div>";
    html += '<div class="diversity-track"><span style="width: ' + width + '%"></span></div>';
    html += "<p>" + escapeHtml(item.note) + "</p>";
    html += "</div>";
  });

  html += "</div></div>";
  html += '<div class="language-insight-section">';
  html += '<div class="section-heading-row">';
  html += "<div><h3>Rare languages</h3><p>Languages with only one or two resources.</p></div>";
  html += "<p>" + insights.rareLanguages.length + " found</p>";
  html += "</div>";

  if (insights.rareLanguages.length) {
    html += '<div class="rare-language-list">';
    $.each(insights.rareLanguages, function (i, item) {
      html += '<button type="button" class="rare-language-pill" data-language="' + escapeAttribute(item.language) + '">';
      html += escapeHtml(item.language) + " <span>(" + item.count + ")</span>";
      html += "</button>";
    });
    html += "</div>";
  } else {
    html += '<p class="insight-note">No rare languages found.</p>';
  }

  html += "</div></div>";
  $("#languageInsightsContent").html(html);

  $(".language-bar-button, .rare-language-pill").on("click", function () {
    applyLanguageFilter($(this).data("language"));
  });
  $(".language-missing-button").on("click", function () {
    state.maintenance.missingLanguage = true;
    state.page = 1;
    $("#missingLanguageFilter").prop("checked", true);
    closeLanguageInsights();
    render();
  });
}

function renderLanguageOverviewCard(number, label, note) {
  return (
    '<div class="language-overview-card">' +
    '<span class="language-overview-number">' + escapeHtml(String(number)) + "</span>" +
    '<span class="language-overview-label">'  + escapeHtml(label)          + "</span>" +
    '<p class="language-overview-note">'      + escapeHtml(note)           + "</p>"    +
    "</div>"
  );
}

function applyLanguageFilter(language) {
  state.language = language;
  state.page = 1;
  $("#languageFilter").val(language);
  closeLanguageInsights();
  render();
}

// ---------------------------------------------------------------------------
// Keyword insights modal — uses pre-computed data from /api/metadata
// ---------------------------------------------------------------------------

function openKeywordInsights() {
  renderKeywordInsights();
  $("#keywordInsightsModal").prop("hidden", false);
  $("body").addClass("modal-open");
}

function closeKeywordInsights() {
  $("#keywordInsightsModal").prop("hidden", true);
  $("body").removeClass("modal-open");
}

function getKeywordInsights() {
  var ki    = (_metadata && _metadata.insights && _metadata.insights.keywords) || {};
  var total = (_metadata && _metadata.totalResources) || 0;
  var unique = Object.keys((_metadata && _metadata.subjects) || {}).length;

  return {
    totalResources:        total,
    uniqueKeywords:        unique,
    resourcesWithKeywords: ki.withKeywords    || 0,
    missingKeywords:       ki.missingKeywords || 0,
    topKeywords:           ki.topKeywords     || [],
    rareKeywords:          ki.rareKeywords    || [],
    maxKeywordCount:       ki.maxCount        || 0,
    coverage: [
      { label: "No keywords",   count: ki.zero        || 0, note: "resources with no keywords" },
      { label: "1–2 keywords",  count: ki.oneTwo      || 0, note: "resources with one or two keywords" },
      { label: "3–5 keywords",  count: ki.threeToFive || 0, note: "resources with three to five keywords" },
      { label: "6+ keywords",   count: ki.sixPlus     || 0, note: "resources with six or more keywords" }
    ]
  };
}

function renderKeywordInsights() {
  var insights = getKeywordInsights();
  var html     = "";

  html += '<div class="language-overview-grid keyword-overview-grid">';
  html += renderLanguageOverviewCard(insights.uniqueKeywords,        "Keywords",         "unique keywords in the dataset");
  html += renderLanguageOverviewCard(insights.resourcesWithKeywords, "Tagged resources", "resources with at least one keyword");
  html += renderLanguageOverviewCard(insights.missingKeywords,       "Missing keywords", "resources needing keyword data");
  html += "</div>";

  if (insights.missingKeywords > 0) {
    html += '<div class="language-action-strip">';
    html += "<span>There are resources without keyword data.</span>";
    html += '<button type="button" class="keyword-missing-button">Show resources missing keywords</button>';
    html += "</div>";
  }

  html += '<div class="language-insight-grid">';
  html += '<div class="language-insight-section">';
  html += '<div class="section-heading-row">';
  html += "<div><h3>Top keywords</h3><p>Click a keyword to filter.</p></div>";
  html += "<p>" + insights.topKeywords.length + " shown</p>";
  html += "</div>";
  html += '<div class="language-bar-list">';

  $.each(insights.topKeywords, function (i, item) {
    var width = insights.maxKeywordCount
      ? Math.round((item.count / insights.maxKeywordCount) * 100)
      : 0;
    html += '<button type="button" class="language-bar-button keyword-bar-button" data-keyword="' + escapeAttribute(item.keyword) + '">';
    html += '<span class="language-bar-label">' + escapeHtml(item.keyword) + "</span>";
    html += '<span class="language-bar-track"><span class="language-bar-fill" style="width:' + width + '%"></span></span>';
    html += '<span class="language-bar-count">' + item.count + "</span>";
    html += "</button>";
  });

  html += "</div></div>";
  html += '<div class="language-insight-section">';
  html += "<h3>Keyword coverage</h3>";
  html += '<div class="diversity-list">';

  $.each(insights.coverage, function (i, item) {
    var width = insights.totalResources
      ? Math.round((item.count / insights.totalResources) * 100)
      : 0;
    html += '<div class="diversity-row">';
    html += '<div class="diversity-row-top"><span>' + escapeHtml(item.label) + "</span><strong>" + item.count + "</strong></div>";
    html += '<div class="diversity-track"><span style="width:' + width + '%"></span></div>';
    html += "<p>" + escapeHtml(item.note) + "</p>";
    html += "</div>";
  });

  html += "</div>";
  html += '<div class="section-heading-row" style="margin-top:16px">';
  html += "<div><h3>Rarely used keywords</h3><p>Used only once or twice.</p></div>";
  html += "<p>" + insights.rareKeywords.length + " found</p>";
  html += "</div>";

  if (insights.rareKeywords.length) {
    html += '<div class="rare-language-list">';
    $.each(insights.rareKeywords, function (i, item) {
      html += '<button type="button" class="rare-language-pill keyword-rare-pill" data-keyword="' + escapeAttribute(item.keyword) + '">';
      html += escapeHtml(item.keyword) + " <span>(" + item.count + ")</span>";
      html += "</button>";
    });
    html += "</div>";
  } else {
    html += '<p class="insight-note">No rarely used keywords found.</p>';
  }

  html += "</div></div>";
  $("#keywordInsightsContent").html(html);

  $(".keyword-bar-button, .keyword-rare-pill").on("click", function () {
    var keyword = $(this).data("keyword");
    if (state.subjects.indexOf(keyword) === -1) { state.subjects.push(keyword); }
    state.page = 1;
    closeKeywordInsights();
    render();
  });
  $(".keyword-missing-button").on("click", function () {
    state.maintenance.missingSubject = true;
    state.page = 1;
    $("#missingSubjectFilter").prop("checked", true);
    closeKeywordInsights();
    render();
  });
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getSortableDate(resource) {
  if (!resource.publicationDate) { return null; }
  var match = String(resource.publicationDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) { return null; }
  return match[1] + "-" + match[2] + "-" + match[3];
}

function formatMonthYear(dateValue) {
  if (!dateValue) { return ""; }
  var match = String(dateValue).match(/(\d{4})-(\d{2})/);
  if (!match) { return ""; }
  var year        = match[1];
  var monthNumber = parseInt(match[2], 10);
  var monthNames  = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  if (monthNumber < 1 || monthNumber > 12) { return year; }
  return monthNames[monthNumber - 1] + " " + year;
}

// ---------------------------------------------------------------------------
// URL / Commons helpers
// ---------------------------------------------------------------------------

function getWikimediaPageUrl(wikiPageValue) {
  if (!wikiPageValue) { return ""; }
  return "https://meta.wikimedia.org/wiki/" + encodeURI(String(wikiPageValue).replace(/ /g, "_"));
}

function getYoutubeUrl(youtubeId) {
  if (!youtubeId) { return ""; }
  return "https://www.youtube.com/watch?v=" + encodeURIComponent(youtubeId);
}

function getWikidataUrl(wikidataId) {
  if (!wikidataId) { return ""; }
  return "https://www.wikidata.org/wiki/" + encodeURIComponent(wikidataId);
}

function normalizeCommonsFilePageUrl(url) {
  if (!url) { return ""; }
  var cleanUrl   = String(url).split("?")[0];
  var decodedUrl = decodeURIComponent(cleanUrl);
  var fileName   = "";

  var specialFilePathMatch = decodedUrl.match(/commons\.wikimedia\.org\/wiki\/Special:FilePath\/(.+)$/i);
  if (specialFilePathMatch) { fileName = specialFilePathMatch[1]; }

  if (!fileName && decodedUrl.indexOf("upload.wikimedia.org/") !== -1) {
    fileName = decodedUrl.split("/").pop();
  }
  if (!fileName && decodedUrl.match(/commons\.wikimedia\.org\/wiki\/File:/i)) {
    fileName = decodedUrl.split(/\/wiki\/File:/i).pop();
  }
  if (!fileName) { return url; }

  fileName = fileName.replace(/ /g, "_");
  return "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(fileName).replace(/%2F/g, "/");
}

// ---------------------------------------------------------------------------
// Escape helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value || "#");
}
