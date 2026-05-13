/* global $ */
"use strict";

// Keep these paths relative so the app can be served from any static host.
var resourcesUrl = "data/resources.json";
var metadataUrl = "data/metadata.json";

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

var resources = [];

// Number of cards shown per page. Chosen to fill common screen widths
// (the grid uses auto-fill at 255 px min, so 48 cards = 8 rows of 6).
var PAGE_SIZE = 48;

var state = {
  search: "",
  types: [],           // multi-select resource types (array of Q-IDs)
  language: "",
  year: "",            // single publication year filter, e.g. "2021"
  subjects: [],        // multi-select, like publishers/authors
  subjectSearch: "",
  publisherSearch: "",
  publishers: [],
  authorSearch: "",
  authors: [],
  maintenance: {
    missingDescription: false,
    missingSubject: false,
    missingLanguage: false,
    missingPublicationDate: false,
    hasUnlinkedAuthor: false
  },
  sort: "id-desc",
  page: 1,
  view: "grid"   // "grid" | "list"
};

// ---------------------------------------------------------------------------
// URL state — read, write, sync
// ---------------------------------------------------------------------------

/**
 * Read URL search params into `state`.
 * Called once on page load, and again on popstate.
 */
function readStateFromUrl() {
  var params = new URLSearchParams(location.search);

  state.search        = params.get("q")       || "";
  state.types         = params.getAll("type");
  state.language      = params.get("lang")    || "";
  state.year          = params.get("year")    || "";
  state.subjects   = params.getAll("subject");
  state.publishers    = params.getAll("publisher");
  state.authors       = params.getAll("author");

  var missingStr   = params.get("missing") || "";
  var missingFlags = missingStr ? missingStr.split(",") : [];
  state.maintenance.missingDescription    = missingFlags.indexOf("description") !== -1;
  state.maintenance.missingSubject        = missingFlags.indexOf("subject")     !== -1;
  state.maintenance.missingLanguage       = missingFlags.indexOf("language")    !== -1;
  state.maintenance.missingPublicationDate = missingFlags.indexOf("pubdate")    !== -1;
  state.maintenance.hasUnlinkedAuthor     = missingFlags.indexOf("unlinkedauthor") !== -1;

  var sort = params.get("sort");
  // Migrate legacy ?sort=id (string sort) to id-asc (numeric, ascending)
  if (sort === "id") { sort = "id-asc"; }
  state.sort = sort || "id-desc";

  var page = parseInt(params.get("page"), 10);
  state.page = (page && page > 0) ? page : 1;

  var view = params.get("view");
  state.view = (view === "list") ? "list" : "grid";

  // Search-within-panel fields are intentionally not persisted in the URL
  // because they are transient UI state, not part of the shareable view.
  state.subjectSearch   = "";
  state.publisherSearch = "";
  state.authorSearch    = "";
}

/**
 * Serialise the current `state` into a URLSearchParams object.
 * Parameters that are at their default value are omitted to keep URLs clean.
 */
function buildUrlParams() {
  var params = new URLSearchParams();

  if (state.search)     params.set("q",    state.search);
  if (state.language)   params.set("lang", state.language);
  if (state.year)       params.set("year", state.year);
  $.each(state.subjects,   function (i, s) { params.append("subject",   s); });

  // Multi-value: repeated params
  $.each(state.types,      function (i, t) { params.append("type",      t); });
  $.each(state.publishers, function (i, p) { params.append("publisher", p); });
  $.each(state.authors,    function (i, a) { params.append("author",    a); });

  // Missing-data flags: closed set of single words, comma list is fine.
  var missingFlags = [];
  if (state.maintenance.missingDescription)     missingFlags.push("description");
  if (state.maintenance.missingSubject)         missingFlags.push("subject");
  if (state.maintenance.missingLanguage)        missingFlags.push("language");
  if (state.maintenance.missingPublicationDate) missingFlags.push("pubdate");
  if (state.maintenance.hasUnlinkedAuthor)      missingFlags.push("unlinkedauthor");
  if (missingFlags.length) params.set("missing", missingFlags.join(","));

  // Omit sort when it is the default to keep the common-case URL clean.
  if (state.sort && state.sort !== "id-desc") params.set("sort", state.sort);

  // Omit page 1 — it is the default and its absence keeps URLs clean.
  if (state.page && state.page > 1) params.set("page", state.page);

  // Omit view=grid — grid is the default.
  if (state.view === "list") params.set("view", "list");

  return params;
}

/**
 * Replace the current history entry with a URL that reflects the current state.
 * We use replaceState (not pushState) because this is a filter tool:
 * each individual filter change should not create a separate back-button step.
 */
function replaceUrlState() {
  var params  = buildUrlParams();
  var search  = params.toString();
  var newUrl  = search ? location.pathname + "?" + search : location.pathname;
  history.replaceState({ meow: true }, "", newUrl);
}

/**
 * Push all transient filter state back into the HTML controls.
 * Called after readStateFromUrl() so the page looks consistent with the URL.
 */
function syncUiToState() {
  $("#searchInput").val(state.search);
  $("#languageFilter").val(state.language);
  $("#sortSelect").val(state.sort);
  $("#missingDescriptionFilter").prop("checked", state.maintenance.missingDescription);
  $("#missingSubjectFilter").prop("checked",     state.maintenance.missingSubject);
  $("#missingLanguageFilter").prop("checked",    state.maintenance.missingLanguage);
  $("#missingPublicationDateFilter").prop("checked", state.maintenance.missingPublicationDate);
  $("#hasUnlinkedAuthorFilter").prop("checked",  state.maintenance.hasUnlinkedAuthor);
  // Sync view toggle button pressed states.
  $("#viewGrid").attr("aria-pressed", state.view === "grid").toggleClass("is-active", state.view === "grid");
  $("#viewList").attr("aria-pressed", state.view === "list").toggleClass("is-active", state.view === "list");
  // Panel search fields are not persisted; clear them.
  $("#subjectSearchInput").val("");
  $("#publisherSearchInput").val("");
  $("#authorSearchInput").val("");
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
// CSV export
// ---------------------------------------------------------------------------

function initExportCsvButton() {
  $("#exportCsvButton").on("click", function () {
    exportCsv();
  });
}

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

/**
 * Build a CSV string from the currently filtered result set (all pages),
 * then trigger a browser download.
 *
 * Columns
 * -------
 * id, title, type, description, publication_date, publication_month_year,
 * languages, subjects, publishers, authors, primary_url, metabase_url
 *
 * Multi-value fields (languages, subjects, publishers, authors) are stored
 * as pipe-separated lists inside a single quoted cell, e.g. "English | Swedish".
 *
 * All cells are wrapped in double-quotes and internal double-quotes are
 * escaped by doubling them ("") — this is the RFC 4180 standard and is
 * understood by Excel, Google Sheets, LibreOffice Calc, and every CSV parser.
 *
 * A UTF-8 BOM is prepended so that Excel on Windows opens the file with the
 * correct encoding without requiring the user to go through the import wizard.
 */
function exportCsv() {
  var filtered = getFilteredResources();  // full filtered set, no page slicing

  var columns = [
    "id",
    "title",
    "type",
    "description",
    "publication_date",
    "publication_month_year",
    "languages",
    "keywords",
    "publishers",
    "authors",
    "temp_authors",
    "primary_url",
    "metabase_url"
  ];

  var rows = [columns.map(csvQuote).join(",")];

  $.each(filtered, function (i, r) {
    var row = [
      r.id,
      r.title,
      r.typeLabel,
      r.description,
      r.publicationDate,
      r.publicationMonthYear,
      r.languages.join(" | "),
      r.subjects.join(" | "),
      r.publishers.join(" | "),
      r.authors.join(" | "),
      (r.tempAuthors || []).join(" | "),
      r.primaryUrl,
      r.metabaseUrl
    ].map(csvQuote).join(",");

    rows.push(row);
  });

  var csv      = rows.join("\r\n");   // RFC 4180 mandates CRLF line endings
  var bom      = "\uFEFF";            // UTF-8 BOM — makes Excel happy on Windows
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

  // Release the object URL shortly after — it is no longer needed.
  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
}

/**
 * Wrap a single CSV cell value in double-quotes and escape any internal
 * double-quotes by doubling them, per RFC 4180.
 *
 * Always quotes every cell (not just those that need it) for simplicity
 * and to guarantee correct round-tripping regardless of cell content.
 */
function csvQuote(value) {
  var str = (value === null || value === undefined) ? "" : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Build a descriptive filename for the download, e.g.:
 *   meow-export.csv                     (no filters)
 *   meow-export-online-courses.csv      (type filter active)
 *   meow-export-2025-05-06.csv          (no type filter, date appended)
 *
 * The date suffix helps users distinguish successive exports.
 */
function buildExportFilename() {
  var parts = ["meow-export"];

  if (state.types.length === 1 && resourceTypes[state.types[0]]) {
    parts.push(slugify(resourceTypes[state.types[0]].pluralLabel));
  }
  var today = new Date();
  var yyyy  = today.getFullYear();
  var mm    = String(today.getMonth() + 1).padStart(2, "0");
  var dd    = String(today.getDate()).padStart(2, "0");
  parts.push(yyyy + "-" + mm + "-" + dd);

  return parts.join("-") + ".csv";
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Title reset — clicking the MEOW heading resets the app to default state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Top navigation menu — About / GitHub / How to contribute
// ---------------------------------------------------------------------------

function initNavMenu() {
  // About modal
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

  // Contribute modal
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

  // Escape key closes whichever modal is open
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
// Jump to top button
// ---------------------------------------------------------------------------

function initJumpToTop() {
  var $btn = $("#jumpToTop");

  // Show the button once the user has scrolled past ~300 px.
  $(window).on("scroll.jumpToTop", function () {
    if ($(window).scrollTop() > 300) {
      $btn.addClass("is-visible");
    } else {
      $btn.removeClass("is-visible");
    }
  });

  $btn.on("click", function () {
    $("html, body").animate({ scrollTop: 0 }, 220);
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

$(function () {

  // Read state from the URL before any data loads, so filter panels build
  // with the correct selections already applied.
  readStateFromUrl();

  // --- Event bindings -------------------------------------------------

  $("#searchInput").on("input", function () {
    state.search = $(this).val().trim().toLowerCase();
    state.page = 1;
    render();
  });

  $("#publisherSearchInput").on("input", function () {
    state.publisherSearch = $(this).val().trim().toLowerCase();
    buildPublisherFilters();
  });

  $("#authorSearchInput").on("input", function () {
    state.authorSearch = $(this).val().trim().toLowerCase();
    buildAuthorFilters();
  });

  $("#clearSearch").on("click", function () {
    clearAllFilters();
  });

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

  $("#subjectSearchInput").on("input", function () {
    state.subjectSearch = $(this).val().trim().toLowerCase();
    buildSubjectPanel();
  });

  $("#missingDescriptionFilter").on("change", function () {
    state.maintenance.missingDescription = $(this).is(":checked");
    state.page = 1;
    render();
  });

  $("#missingSubjectFilter").on("change", function () {
    state.maintenance.missingSubject = $(this).is(":checked");
    state.page = 1;
    render();
  });

  $("#missingLanguageFilter").on("change", function () {
    state.maintenance.missingLanguage = $(this).is(":checked");
    state.page = 1;
    render();
  });

  $("#missingPublicationDateFilter").on("change", function () {
    state.maintenance.missingPublicationDate = $(this).is(":checked");
    state.page = 1;
    render();
  });

  $("#hasUnlinkedAuthorFilter").on("change", function () {
    state.maintenance.hasUnlinkedAuthor = $(this).is(":checked");
    state.page = 1;
    render();
  });

  $("#resetFilters").on("click", function () {
    clearAllFilters();
  });

  $("#closeLanguageInsights").on("click", function () { closeLanguageInsights(); });
  $("#closeKeywordInsights").on("click",  function () { closeKeywordInsights(); });

  $("#languageInsightsModal").on("click", function (event) {
    if (event.target === this) { closeLanguageInsights(); }
  });

  $("#keywordInsightsModal").on("click", function (event) {
    if (event.target === this) { closeKeywordInsights(); }
  });

  $(document).on("keydown", function (event) {
    if (event.key === "Escape") {
      closeLanguageInsights();
      closeKeywordInsights();
    }
  });

  // Restore state if the user navigates back to a previous URL via the
  // browser's own back/forward buttons. (popstate fires on replaceState
  // navigation only in some browsers, but we handle it for robustness.)
  $(window).on("popstate", function () {
    readStateFromUrl();
    syncUiToState();
    // Panels need to be rebuilt so selections are reflected correctly.
    buildResourceTypeFilter();
    buildLanguageFilter();
    buildYearFilter();
    buildPublisherFilters();
    buildAuthorFilters();
    buildSubjectPanel();
    render();
  });

  initCopyLinkButton();
  initExportCsvButton();
  initViewToggle();
  initNavMenu();
  initTitleReset();
  initJumpToTop();
  loadMetadata();
  loadResources();
});

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function clearAllFilters() {
  state.search       = "";
  state.types        = [];
  state.language     = "";
  state.year         = "";
  state.subjects        = [];
  state.subjectSearch   = "";
  state.publisherSearch = "";
  state.authorSearch    = "";
  state.publishers   = [];
  state.authors      = [];
  state.maintenance.missingDescription    = false;
  state.maintenance.missingSubject        = false;
  state.maintenance.missingLanguage       = false;
  state.maintenance.missingPublicationDate = false;
  state.maintenance.hasUnlinkedAuthor     = false;
  state.page         = 1;

  syncUiToState();
  syncPublisherFilters();
  syncAuthorFilters();
  render();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadMetadata() {
  $.getJSON(metadataUrl)
    .done(function (metadata) {
      if (!metadata.generatedAt) {
        $("#dataUpdatedAt").text("Data last updated: unknown");
        return;
      }

      var date = new Date(metadata.generatedAt);

      if (isNaN(date.getTime())) {
        $("#dataUpdatedAt").text("Data last updated: unknown");
        return;
      }

      var formatted = date.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
      });

      var note = "Data last updated: " + formatted;
      if (metadata.failedResourceTypes && metadata.failedResourceTypes.length) {
        note += " · partial harvest";
      }
      $("#dataUpdatedAt").text(note);
    })
    .fail(function () {
      $("#dataUpdatedAt").text("Data last updated: unknown");
    });
}

function loadResources() {
  $("#resultCount").text("Loading resources…");
  $("#results").attr("aria-busy", "true");
  $("#statusMessage").empty();

  $.getJSON(resourcesUrl)
    .done(function (data) {
      resources = normalizeResources(data);
      $("#results").attr("aria-busy", "false");

      buildResourceTypeFilter();
      buildLanguageFilter();
      buildYearFilter();
      buildPublisherFilters();
      buildAuthorFilters();
      buildSubjectPanel();
      renderSummaryStats();

      // Unlock the export button now that we have data.
      $("#exportCsvButton").prop("disabled", false);

      // Sync HTML controls to whatever was read from the URL on page load.
      syncUiToState();
      render();
    })
    .fail(function (xhr, status, error) {
      $("#resultCount").text("Could not load resources");
      $("#results").attr("aria-busy", "false").empty();

      $("#statusMessage").html(
        '<div class="error-state">' +
        "<strong>Could not load local data.</strong><br>" +
        "Make sure <code>data/resources.json</code> exists and that you are " +
        "running the app through a local web server, not directly from the file system." +
        "</div>"
      );

      console.error("JSON load error:", status, error);
    });
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeResources(data) {
  var normalized = [];

  $.each(data, function (i, resource) {
    var id                  = resource.id || "";
    var typeIds             = resource.typeIds || (resource.typeId ? [resource.typeId] : []);
    var courseUrl           = resource.courseUrl || "";
    var commonsVideoPage    = normalizeCommonsFilePageUrl(resource.commonsVideoPage    || "");
    var commonsDocumentPage = normalizeCommonsFilePageUrl(resource.commonsDocumentPage || "");
    var wikiPageUrl         = getWikimediaPageUrl(resource.wikiPage);
    var primaryUrl          = courseUrl || commonsVideoPage || commonsDocumentPage || wikiPageUrl;

    normalized.push({
      id:                   id,
      typeIds:              typeIds,
      typeId:               typeIds[0] || "",   // kept for backward compat in sort/CSV
      typeLabel:            typeIds.map(function (t) { return getResourceTypeLabel(t); }).join(", "),
      title:                resource.title || id || "",
      description:          resource.description || "",
      publicationDate:      resource.publicationDate || "",
      publicationMonthYear: formatMonthYear(resource.publicationDate),
      courseUrl:            courseUrl,
      commonsVideoPage:     commonsVideoPage,
      commonsDocumentPage:  commonsDocumentPage,
      wikiPage:             resource.wikiPage || "",
      wikiPageUrl:          wikiPageUrl,
      metabaseUrl:          "https://metabase.wikibase.cloud/wiki/Item:" + id,
      primaryUrl:           primaryUrl,
      primaryUrlLabel:      "",
      publishers:           resource.publishers || [],
      languages:            resource.languages  || [],
      authors:              resource.authors    || [],
      subjects:             resource.subjects   || [],
      tempAuthors:          resource.tempAuthors || [],
      missing: {
        description:     hasMissing(resource, "description",    !resource.description),
        mainSubject:     hasMissing(resource, "mainSubject",    !(resource.subjects   && resource.subjects.length)),
        publisher:       hasMissing(resource, "publisher",      !(resource.publishers && resource.publishers.length)),
        publicationDate: hasMissing(resource, "publicationDate", !resource.publicationDate),
        language:        hasMissing(resource, "language",       !(resource.languages  && resource.languages.length)),
        externalLink:    hasMissing(resource, "externalLink",   !primaryUrl),
        unlinkedAuthor:  hasMissing(resource, "unlinkedAuthor", !!(resource.tempAuthors && resource.tempAuthors.length))
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
// Filter panel builders
// ---------------------------------------------------------------------------

function buildResourceTypeFilter() {
  var pool       = applyFilters(resources, "types");
  var counts     = {};
  var foundTypes = [];

  $.each(pool, function (i, resource) {
    $.each(resource.typeIds, function (j, typeId) {
      if (!counts[typeId]) {
        counts[typeId] = 0;
        foundTypes.push(typeId);
      }
      counts[typeId] += 1;
    });
  });

  // Alphabetical by label
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
    html += '<span class="resource-type-filter-count">' + counts[typeId] + "</span>";
    html += "</button>";
  });

  $("#resourceTypeFilters").html(html);

  $(".resource-type-filter-button").on("click", function () {
    toggleTypeFilter($(this).data("type-id"));
  });
}

function buildLanguageFilter() {
  var pool      = applyFilters(resources, "language");
  var counts    = {};
  var languages = [];

  $.each(pool, function (i, resource) {
    $.each(resource.languages, function (j, language) {
      if (!counts[language]) { counts[language] = 0; languages.push(language); }
      counts[language] += 1;
    });
  });

  languages.sort(function (a, b) {
    if (counts[b] !== counts[a]) { return counts[b] - counts[a]; }
    return a.localeCompare(b);
  });

  var html = "<option value=\"\">All languages</option>";

  $.each(languages, function (i, language) {
    html += '<option value="' + escapeAttribute(language) + '"';
    if (state.language === language) { html += " selected"; }
    html += ">";
    html += escapeHtml(language) + " (" + counts[language] + ")";
    html += "</option>";
  });

  $("#languageFilter").html(html);
}

/**
 * Build the publication year histogram in the left sidebar.
 *
 * Each year is rendered as a clickable bar showing:
 *   [year]  [████████████]  [count]
 *
 * The bar width is proportional to the highest count across all visible
 * years. Counts are computed against the pool filtered by everything
 * *except* the year dimension, so the chart stays useful while a year
 * is selected (you can see what switching would give you).
 *
 * Resources with no publication date are counted separately and shown
 * at the bottom as a non-interactive note.
 */
function buildYearFilter() {
  var pool     = applyFilters(resources, "year");
  var counts   = {};
  var noDate   = 0;

  $.each(pool, function (i, resource) {
    // Use regex to extract the 4-digit year, handling both "2021-01-01T..."
    // and Wikibase's "+2021-01-01T..." prefix format.
    var raw  = resource.publicationDate ? String(resource.publicationDate) : "";
    var m    = raw.match(/(\d{4})/);
    var year = m ? m[1] : "";
    if (!year) { noDate += 1; return; }
    counts[year] = (counts[year] || 0) + 1;
  });

  var years = Object.keys(counts).sort();   // chronological order

  if (!years.length) {
    $("#yearFilters").html('<p class="filter-empty">No publication dates found.</p>');
    return;
  }

  var maxCount = 0;
  $.each(years, function (i, y) { if (counts[y] > maxCount) { maxCount = counts[y]; } });

  var html = "";

  $.each(years, function (i, year) {
    var pct     = maxCount ? Math.round((counts[year] / maxCount) * 100) : 0;
    var active  = state.year === year;
    html += '<button type="button" class="year-bar-button' + (active ? " is-active" : "") + '"';
    html += ' data-year="' + escapeAttribute(year) + '">';
    html += '<span class="year-bar-label">' + escapeHtml(year) + "</span>";
    html += '<span class="year-bar-track"><span class="year-bar-fill" style="width:' + pct + '%"></span></span>';
    html += '<span class="year-bar-count">' + counts[year] + "</span>";
    html += "</button>";
  });

  if (noDate) {
    html += '<p class="year-no-date">No date: ' + noDate + "</p>";
  }

  $("#yearFilters").html(html);

  $(".year-bar-button").on("click", function () {
    // Use attr() not data() — jQuery's .data() auto-converts "2021" to
    // the integer 2021, which then fails strict string comparison in applyFilters.
    var year = $(this).attr("data-year");
    state.year = (state.year === year) ? "" : year;
    state.page = 1;
    render();
  });
}

function buildPublisherFilters() {
  var pool       = applyFilters(resources, "publishers");
  var counts     = {};
  var publishers = [];

  $.each(pool, function (i, resource) {
    $.each(resource.publishers, function (j, publisher) {
      if (!counts[publisher]) {
        counts[publisher] = 0;
        publishers.push(publisher);
      }
      counts[publisher] += 1;
    });
  });

  publishers.sort(function (a, b) {
    if (counts[b] !== counts[a]) { return counts[b] - counts[a]; }
    return a.localeCompare(b);
  });

  if (state.publisherSearch) {
    publishers = publishers.filter(function (publisher) {
      return publisher.toLowerCase().indexOf(state.publisherSearch) !== -1;
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
    html += '<span class="publisher-filter-count">' + counts[publisher] + "</span>";
    html += "</button>";
  });

  $("#publisherFilters").html(html);

  $(".publisher-filter-button").on("click", function () {
    togglePublisherFilter($(this).data("publisher"));
  });
}

function buildAuthorFilters() {
  var pool    = applyFilters(resources, "authors");
  var counts  = {};
  var authors = [];

  $.each(pool, function (i, resource) {
    $.each(resource.authors, function (j, author) {
      if (!counts[author]) {
        counts[author] = 0;
        authors.push(author);
      }
      counts[author] += 1;
    });
  });

  authors.sort(function (a, b) {
    if (counts[b] !== counts[a]) { return counts[b] - counts[a]; }
    return a.localeCompare(b);
  });

  if (state.authorSearch) {
    authors = authors.filter(function (author) {
      return author.toLowerCase().indexOf(state.authorSearch) !== -1;
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
    html += '<span class="author-filter-count">' + counts[author] + "</span>";
    html += "</button>";
  });

  $("#authorFilters").html(html);

  $(".author-filter-button").on("click", function () {
    toggleAuthorFilter($(this).data("author"));
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

function buildSubjectPanel() {
  var pool     = applyFilters(resources, "subjects");
  var counts   = {};
  var subjects = [];

  $.each(pool, function (i, resource) {
    $.each(resource.subjects, function (j, subject) {
      if (!counts[subject]) {
        counts[subject] = 0;
        subjects.push(subject);
      }
      counts[subject] += 1;
    });
  });

  subjects.sort(function (a, b) {
    if (counts[b] !== counts[a]) { return counts[b] - counts[a]; }
    return a.localeCompare(b);
  });

  if (state.subjectSearch) {
    subjects = subjects.filter(function (subject) {
      return subject.toLowerCase().indexOf(state.subjectSearch) !== -1;
    });
  }

  // Show active count alongside shown count, matching publisher/author pattern.
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
    html += '<span class="subject-filter-count">' + counts[subject] + "</span>";
    html += "</button>";
  });

  $("#subjectFilters").html(html);
  $(".subject-filter-button").on("click", function () {
    toggleSubjectFilter($(this).data("subject"));
  });
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

/**
 * Filter `pool` (an array of resources) against the current state.
 *
 * `excludeKey` is an optional string that names one filter to skip.
 * Panel builders pass their own key so they show the universe of values
 * that would still be available if the user chose a different value for
 * that dimension (standard "conjunctive faceted search" behaviour).
 *
 * Valid excludeKey values: "types", "language", "subject",
 *                           "publishers", "authors"
 */
function applyFilters(pool, excludeKey) {
  return pool.filter(function (resource) {
    var haystack = [
      resource.id,
      resource.title,
      resource.description,
      resource.typeLabel,
      resource.publishers.join(" "),
      resource.authors.join(" "),
      resource.languages.join(" "),
      resource.subjects.join(" ")
    ].join(" ").toLowerCase();

    if (state.search && haystack.indexOf(state.search) === -1) { return false; }

    if (excludeKey !== "types") {
      if (state.types.length && !hasAnyValue(resource.typeIds, state.types)) { return false; }
    }

    if (excludeKey !== "language") {
      if (state.language && resource.languages.indexOf(state.language) === -1) { return false; }
    }

    if (excludeKey !== "year") {
      if (state.year) {
        var raw     = resource.publicationDate ? String(resource.publicationDate) : "";
        var yearMatch = raw.match(/(\d{4})/);
        var pubYear   = yearMatch ? yearMatch[1] : "";
        if (pubYear !== state.year) { return false; }
      }
    }

    if (excludeKey !== "subjects") {
      if (state.subjects.length && !hasAnyValue(resource.subjects, state.subjects)) { return false; }
    }

    if (excludeKey !== "publishers") {
      if (state.publishers.length && !hasAnyValue(resource.publishers, state.publishers)) { return false; }
    }

    if (excludeKey !== "authors") {
      if (state.authors.length && !hasAnyValue(resource.authors, state.authors)) { return false; }
    }

    if (state.maintenance.missingDescription    && !resource.missing.description)    { return false; }
    if (state.maintenance.missingSubject        && !resource.missing.mainSubject)    { return false; }
    if (state.maintenance.missingLanguage       && !resource.missing.language)       { return false; }
    if (state.maintenance.missingPublicationDate && !resource.missing.publicationDate) { return false; }
    if (state.maintenance.hasUnlinkedAuthor     && !resource.missing.unlinkedAuthor) { return false; }

    return true;
  });
}

function getFilteredResources() {
  var filtered = applyFilters(resources, null);

  filtered.sort(function (a, b) {
    if (state.sort === "id-asc" || state.sort === "id-desc") {
      // Strip the leading "Q" and compare as integers so Q22 < Q43 < Q3454 < Q12343
      var numA = parseInt(a.id.replace(/^Q/i, ""), 10);
      var numB = parseInt(b.id.replace(/^Q/i, ""), 10);
      if (isNaN(numA) && isNaN(numB)) { return a.id.localeCompare(b.id); }
      if (isNaN(numA)) { return 1; }
      if (isNaN(numB)) { return -1; }
      return state.sort === "id-asc" ? numA - numB : numB - numA;
    }

    if (state.sort === "type") {
      var typeCompare = getResourceTypeLabel(a.typeIds[0] || "").localeCompare(getResourceTypeLabel(b.typeIds[0] || ""));
      return typeCompare !== 0 ? typeCompare : a.title.localeCompare(b.title);
    }

    if (state.sort === "date-desc" || state.sort === "date-asc") {
      var dateA = getSortableDate(a);
      var dateB = getSortableDate(b);

      if (!dateA && !dateB) { return a.title.localeCompare(b.title); }
      if (!dateA)           { return 1; }
      if (!dateB)           { return -1; }

      if (dateA !== dateB) {
        return state.sort === "date-desc"
          ? dateB.localeCompare(dateA)
          : dateA.localeCompare(dateB);
      }

      return a.title.localeCompare(b.title);
    }

    return a.title.localeCompare(b.title);
  });

  return filtered;
}

function hasAnyValue(values, selectedValues) {
  var found = false;
  $.each(selectedValues, function (i, value) {
    if (values.indexOf(value) !== -1) { found = true; }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderSummaryStats() {
  var stats = getSummaryStats(resources);
  var html  = "";

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

function getSummaryStats(resourceList) {
  var typeSet      = {};
  var languageSet  = {};
  var subjectSet   = {};
  var publisherSet = {};
  var authorSet    = {};

  $.each(resourceList, function (i, resource) {
    $.each(resource.typeIds,    function (j, t) { typeSet[t]       = true; });
    $.each(resource.languages,  function (j, l) { languageSet[l]  = true; });
    $.each(resource.subjects,   function (j, s) { subjectSet[s]   = true; });
    $.each(resource.publishers, function (j, p) { publisherSet[p] = true; });
    $.each(resource.authors,    function (j, a) { authorSet[a]    = true; });
  });

  return {
    resources:     resourceList.length,
    resourceTypes: Object.keys(typeSet).length,
    languages:     Object.keys(languageSet).length,
    subjects:      Object.keys(subjectSet).length,
    publishers:    Object.keys(publisherSet).length,
    authors:       Object.keys(authorSet).length
  };
}

function renderActiveFilters() {
  var hasTypes       = state.types.length > 0;
  var hasYear        = !!state.year;
  var hasSubjects    = state.subjects.length > 0;
  var hasPublishers  = state.publishers.length > 0;
  var hasAuthors     = state.authors.length > 0;
  var hasMaintenance =
    state.maintenance.missingDescription    ||
    state.maintenance.missingSubject        ||
    state.maintenance.missingLanguage       ||
    state.maintenance.missingPublicationDate ||
    state.maintenance.hasUnlinkedAuthor;

  if (!hasTypes && !hasYear && !hasSubjects && !hasPublishers && !hasAuthors && !hasMaintenance) {
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

  if (hasMaintenance) {
    var labels = [];
    if (state.maintenance.missingDescription)     { labels.push("missing description"); }
    if (state.maintenance.missingSubject)         { labels.push("missing keyword"); }
    if (state.maintenance.missingLanguage)        { labels.push("missing language"); }
    if (state.maintenance.missingPublicationDate) { labels.push("missing publication date"); }
    if (state.maintenance.hasUnlinkedAuthor)      { labels.push("has unlinked author"); }

    html += "<span>Improve data: <strong>" + escapeHtml(labels.join(", ")) + "</strong></span>";
    html += '<button type="button" class="clear-maintenance-filter">Clear improve data</button>';
  }

  html += "</div>";

  $("#activeFilters").html(html);

  $(".clear-type-filter").on("click", function () {
    state.types = [];
    state.page = 1;
    syncTypeFilters();
    render();
  });

  $(".clear-year-filter").on("click", function () {
    state.year = "";
    state.page = 1;
    render();
  });

  $(".remove-subject-chip").on("click", function () {
    var subject = $(this).data("subject");
    state.subjects = state.subjects.filter(function (s) { return s !== subject; });
    state.page = 1;
    render();
  });

  $(".clear-publisher-filter").on("click", function () {
    state.publishers = [];
    state.page = 1;
    syncPublisherFilters();
    render();
  });

  $(".clear-author-filter").on("click", function () {
    state.authors = [];
    state.page = 1;
    syncAuthorFilters();
    render();
  });

  $(".clear-maintenance-filter").on("click", function () {
    state.maintenance.missingDescription    = false;
    state.maintenance.missingSubject        = false;
    state.maintenance.missingLanguage       = false;
    state.maintenance.missingPublicationDate = false;
    state.maintenance.hasUnlinkedAuthor     = false;
    state.page = 1;
    $("#missingDescriptionFilter").prop("checked",    false);
    $("#missingSubjectFilter").prop("checked",        false);
    $("#missingLanguageFilter").prop("checked",       false);
    $("#missingPublicationDateFilter").prop("checked", false);
    $("#hasUnlinkedAuthorFilter").prop("checked",     false);
    render();
  });
}

function render() {
  var filtered   = getFilteredResources();
  var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Clamp page to the valid range (e.g. filters just narrowed the result set).
  if (state.page > totalPages) { state.page = totalPages; }
  if (state.page < 1)          { state.page = 1; }

  var rangeStart = (state.page - 1) * PAGE_SIZE;        // 0-indexed
  var rangeEnd   = Math.min(rangeStart + PAGE_SIZE, filtered.length);
  var pageItems  = filtered.slice(rangeStart, rangeEnd);

  $("#resultCount").text(getResultCountText(filtered.length, rangeStart + 1, rangeEnd));

  renderActiveFilters();
  buildResourceTypeFilter();
  buildLanguageFilter();
  buildYearFilter();
  buildPublisherFilters();
  buildAuthorFilters();
  buildSubjectPanel();

  // Always keep the URL in sync with what is currently displayed.
  replaceUrlState();

  if (!filtered.length) {
    $("#results")
      .removeClass("card-grid card-list")
      .html(
      '<div class="empty-state">No resources found. Try another search term, language, subject, publisher, author or resource type.</div>'
    );
    $("#pagination").empty();
    return;
  }

  var html = (state.view === "list")
    ? renderListItems(pageItems)
    : renderCardItems(pageItems);

  $("#results")
    .removeClass("card-grid card-list")
    .addClass(state.view === "list" ? "card-list" : "card-grid")
    .html(html);

  bindResultEvents();

  renderPagination(filtered.length, totalPages);
}

// ---------------------------------------------------------------------------
// Item renderers
// ---------------------------------------------------------------------------

/**
 * Render type and language badges.
 * context = "grid"  → full pill buttons (card view)
 * context = "list"  → compact plain-text labels (list view)
 */
function renderBadges(resource, context) {
  var html = "";

  if (context === "list") {
    // Compact text-only labels for list view — one per type
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

  // Grid view — full pill buttons — one per type
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

/**
 * Shared publisher HTML. Used by both renderers.
 */
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

/**
 * Shared author HTML. Used by both renderers.
 */
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

/**
 * Temporary free-text author strings (P38 with qualifier P41=P19).
 * These are not linked to Wikibase items yet — displayed with a
 * visual indicator so editors know they need to be resolved.
 */
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

/**
 * Shared subject tags HTML. Used by both renderers.
 */
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

/**
 * Shared external link HTML. Used by both renderers.
 */
function renderLinks(resource, cssClass) {
  var html = "";
  cssClass = cssClass || "card-actions";

  html += '<div class="' + cssClass + '">';

  if (resource.courseUrl) {
    html += '<a class="primary-link" href="' + escapeAttribute(resource.courseUrl) + '" target="_blank" rel="noopener">';
    html += getPrimaryLinkLabel(resource);
    html += "</a>";
  }

  if (resource.commonsVideoPage) {
    html += '<a class="primary-link" href="' + escapeAttribute(resource.commonsVideoPage) + '" target="_blank" rel="noopener">Open video on Commons</a>';
  }

  if (resource.commonsDocumentPage) {
    html += '<a class="primary-link" href="' + escapeAttribute(resource.commonsDocumentPage) + '" target="_blank" rel="noopener">Open on Commons</a>';
  }

  if (resource.wikiPageUrl) {
    html += '<a class="secondary-link" href="' + escapeAttribute(resource.wikiPageUrl) + '" target="_blank" rel="noopener">Open Wikimedia page</a>';
  }

  return html + "</div>";
}

/**
 * Render the current page as a grid of cards.
 * Returns an HTML string.
 */
function renderCardItems(pageItems) {
  var html = "";

  $.each(pageItems, function (i, resource) {
    var formattedDate = resource.publicationMonthYear;

    html += '<article class="resource-card">';
    html += '<div class="card-meta">';
    html += renderBadges(resource, "grid");
    html += '<span class="badge">' + escapeHtml(resource.id) + "</span>";
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
    html += renderTempAuthors(resource);
    html += renderSubjectTags(resource);
    html += renderLinks(resource, "card-actions");
    html += "</article>";
  });

  return html;
}

/**
 * Render the current page as a compact list of rows.
 * Returns an HTML string.
 *
 * Layout (three columns):
 *   [badges]  |  [title + description + meta]  |  [action link]
 */
function renderListItems(pageItems) {
  var html = "";

  $.each(pageItems, function (i, resource) {
    var formattedDate = resource.publicationMonthYear;

    html += '<article class="resource-row">';

    // Left column: clickable type + language badges
    html += '<div class="row-badges">';
    html += renderBadges(resource, "list");
    html += "</div>";

    // Centre column: title, description, meta
    html += '<div class="row-body">';

    html += '<h3 class="row-title">';
    html += '<a class="resource-title-link" href="' + escapeAttribute(resource.metabaseUrl) + '" target="_blank" rel="noopener">';
    html += escapeHtml(resource.title);
    html += "</a></h3>";

    if (resource.description) {
      html += '<p class="description row-description">' + escapeHtml(resource.description) + "</p>";
    }

    // One-line meta strip: date · publisher · author
    var metaParts = [];
    if (formattedDate) {
      metaParts.push('<span class="row-meta-date">📅 ' + escapeHtml(formattedDate) + "</span>");
    }
    if (resource.publishers.length || resource.authors.length) {
      var people = "";
      people += renderPublishers(resource);
      people += renderAuthors(resource);
      metaParts.push(people);
    }

    if (metaParts.length) {
      html += '<div class="row-meta">' + metaParts.join('<span class="row-meta-sep">·</span>') + "</div>";
    }

    html += renderTempAuthors(resource);
    html += renderSubjectTags(resource);

    html += "</div>"; // .row-body

    // Right column: primary action link + ID badge
    html += '<div class="row-actions">';
    html += renderLinks(resource, "row-links");
    html += '<span class="badge row-id-badge">' + escapeHtml(resource.id) + "</span>";
    html += "</div>";

    html += "</article>";
  });

  return html;
}

/**
 * Bind interactive events to the rendered result items.
 * Called once after both renderCardItems and renderListItems.
 */
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
    state.publishers = state.publishers.filter(function (item) {
      return item !== publisher;
    });
  }

  state.page = 1;
  syncPublisherFilters();
  render();
}

function toggleAuthorFilter(author) {
  if (state.authors.indexOf(author) === -1) {
    state.authors.push(author);
  } else {
    state.authors = state.authors.filter(function (item) {
      return item !== author;
    });
  }

  state.page = 1;
  syncAuthorFilters();
  render();
}

function syncPublisherFilters() {
  $(".publisher-filter-button").each(function () {
    var publisher = $(this).data("publisher");
    $(this).toggleClass("is-active", state.publishers.indexOf(publisher) !== -1);
  });
}

function syncAuthorFilters() {
  $(".author-filter-button").each(function () {
    var author = $(this).data("author");
    $(this).toggleClass("is-active", state.authors.indexOf(author) !== -1);
  });
}

// ---------------------------------------------------------------------------
// Label / text helpers
// ---------------------------------------------------------------------------

function getResultCountText(total, from, to) {
  var label = "resources";
  if (state.types.length === 1 && resourceTypes[state.types[0]]) {
    label = resourceTypes[state.types[0]].pluralLabel;
  }
  if (total <= PAGE_SIZE) { return total + " " + label; }
  return from + "–" + to + " of " + total + " " + label;
}

/**
 * Render pagination controls into #pagination.
 * Hidden automatically when there is only one page.
 */
function renderPagination(total, totalPages) {
  var $el = $("#pagination");

  if (totalPages <= 1) {
    $el.empty();
    return;
  }

  var current  = state.page;
  var pageNums = getPageNumbers(current, totalPages);
  var html     = "";

  // Previous button
  html += '<button type="button" class="pagination-button pagination-prev"';
  if (current === 1) { html += ' disabled aria-disabled="true"'; }
  html += ' aria-label="Previous page">← Prev</button>';

  // Numbered buttons and ellipses
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

  // Next button
  html += '<button type="button" class="pagination-button pagination-next"';
  if (current === totalPages) { html += ' disabled aria-disabled="true"'; }
  html += ' aria-label="Next page">Next →</button>';

  $el.html(html);

  // Bind clicks — page navigation scrolls back to the top of the results area.
  $(".pagination-prev").on("click", function () {
    if (state.page > 1) {
      state.page -= 1;
      scrollToResults();
      render();
    }
  });

  $(".pagination-next").on("click", function () {
    if (state.page < totalPages) {
      state.page += 1;
      scrollToResults();
      render();
    }
  });

  $(".pagination-number").on("click", function () {
    var target = parseInt($(this).data("page"), 10);
    if (target !== state.page) {
      state.page = target;
      scrollToResults();
      render();
    }
  });
}

/**
 * Return an array of page numbers and "..." strings for the pagination bar.
 *
 * Always shows: first page, last page, current page, and up to WING pages on
 * each side of the current page. Gaps larger than one page become "...".
 *
 * Examples (WING = 2):
 *   current=1, total=19  → [1, 2, 3, "...", 19]
 *   current=5, total=19  → [1, "...", 3, 4, 5, 6, 7, "...", 19]
 *   current=19, total=19 → [1, "...", 17, 18, 19]
 */
function getPageNumbers(current, total) {
  var WING = 2; // pages shown on each side of the current page

  if (total <= 2 * WING + 5) {
    // Small enough to show everything without ellipses.
    var all = [];
    for (var p = 1; p <= total; p++) { all.push(p); }
    return all;
  }

  var rangeStart = Math.max(2, current - WING);
  var rangeEnd   = Math.min(total - 1, current + WING);
  var pages      = [1];

  if (rangeStart > 2)         { pages.push("..."); }
  for (var i = rangeStart; i <= rangeEnd; i++) { pages.push(i); }
  if (rangeEnd < total - 1)   { pages.push("..."); }

  pages.push(total);
  return pages;
}

/**
 * Scroll smoothly to the top of the results area so the user sees the
 * new page of cards without having to scroll up manually.
 */
function scrollToResults() {
  var $results = $("#results");
  if (!$results.length) { return; }

  // Use a small offset so the toolbar stays visible above the fold.
  var offset  = $results.offset().top - 20;
  var current = $(window).scrollTop();

  // Only scroll if the results area is above the current viewport.
  if (current > offset) {
    $("html, body").animate({ scrollTop: offset }, 180);
  }
}

function getPrimaryLinkLabel(resource) {
  // primaryUrlLabel is no longer stored in the data; derive from URL type and typeId.
  if (resource.courseUrl) {
    if (resource.typeId === "Q45501" || resource.typeId === "Q23260") { return "Open course"; }
    if (resource.typeId === "Q23258") { return "Open book"; }
    return "Open resource";
  }
  if (resource.commonsVideoPage)    { return "Open video on Commons"; }
  if (resource.commonsDocumentPage) { return "Open on Commons"; }
  if (resource.wikiPageUrl)         { return "Open Wikimedia page"; }
  return "Open resource";
}

function getResourceTypeLabel(typeId) {
  return resourceTypes[typeId] ? resourceTypes[typeId].label : typeId;
}

// ---------------------------------------------------------------------------
// Language insights modal
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

function renderLanguageInsights() {
  var insights = getLanguageInsights();
  var html     = "";

  html += '<div class="language-overview-grid">';
  html += renderLanguageOverviewCard(insights.uniqueLanguages,      "Languages",        "unique languages in the dataset");
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
    html += '<span class="language-bar-label">'  + escapeHtml(item.language) + "</span>";
    html += '<span class="language-bar-track"><span class="language-bar-fill" style="width: ' + width + '%"></span></span>';
    html += '<span class="language-bar-count">'  + item.count + "</span>";
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

function getLanguageInsights() {
  var languageCounts          = {};
  var languageList            = [];
  var resourcesWithLanguage   = 0;
  var missingLanguage         = 0;
  var monolingual             = 0;
  var bilingual               = 0;
  var multilingual            = 0;
  var totalLanguageAssignments = 0;

  $.each(resources, function (i, resource) {
    var count = resource.languages.length;

    if (count === 0)      { missingLanguage += 1; }
    else                  { resourcesWithLanguage += 1; totalLanguageAssignments += count; }

    if (count === 1)      { monolingual  += 1; }
    else if (count === 2) { bilingual    += 1; }
    else if (count >= 3)  { multilingual += 1; }

    $.each(resource.languages, function (j, language) {
      if (!languageCounts[language]) {
        languageCounts[language] = 0;
        languageList.push(language);
      }
      languageCounts[language] += 1;
    });
  });

  languageList.sort(function (a, b) {
    if (languageCounts[b] !== languageCounts[a]) { return languageCounts[b] - languageCounts[a]; }
    return a.localeCompare(b);
  });

  var topLanguages = languageList.slice(0, 15).map(function (language) {
    return { language: language, count: languageCounts[language] };
  });

  var rareLanguages = languageList.filter(function (language) {
    return languageCounts[language] <= 2;
  }).map(function (language) {
    return { language: language, count: languageCounts[language] };
  });

  rareLanguages.sort(function (a, b) {
    if (a.count !== b.count) { return a.count - b.count; }
    return a.language.localeCompare(b.language);
  });

  return {
    totalResources:        resources.length,
    uniqueLanguages:       languageList.length,
    resourcesWithLanguage: resourcesWithLanguage,
    missingLanguage:       missingLanguage,
    topLanguages:          topLanguages,
    rareLanguages:         rareLanguages,
    maxLanguageCount:      topLanguages.length ? topLanguages[0].count : 0,
    diversity: [
      { label: "Monolingual",      count: monolingual,    note: "resources with exactly one language" },
      { label: "Bilingual",        count: bilingual,      note: "resources with two languages" },
      { label: "Multilingual",     count: multilingual,   note: "resources with three or more languages" },
      { label: "Missing language", count: missingLanguage, note: "resources without language data" }
    ]
  };
}

function applyLanguageFilter(language) {
  state.language = language;
  state.page = 1;
  $("#languageFilter").val(language);
  closeLanguageInsights();
  render();
}

// ---------------------------------------------------------------------------
// Keyword insights modal
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

  // Left: top keywords bar chart
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
    html += '<span class="language-bar-count">'  + item.count + "</span>";
    html += "</button>";
  });

  html += "</div></div>";

  // Right: coverage distribution + rare keywords
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
    if (state.subjects.indexOf(keyword) === -1) {
      state.subjects.push(keyword);
    }
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

function getKeywordInsights() {
  var keywordCounts    = {};
  var keywordList      = [];
  var resourcesWithKeywords = 0;
  var missingKeywords  = 0;
  var zeroKw = 0, oneTwo = 0, threeToFive = 0, sixPlus = 0;

  $.each(resources, function (i, resource) {
    var count = resource.subjects.length;

    if (count === 0)     { missingKeywords += 1; zeroKw += 1; }
    else                 { resourcesWithKeywords += 1; }

    if      (count === 0) { /* already counted */ }
    else if (count <= 2)  { oneTwo += 1; }
    else if (count <= 5)  { threeToFive += 1; }
    else                  { sixPlus += 1; }

    $.each(resource.subjects, function (j, keyword) {
      if (!keywordCounts[keyword]) { keywordCounts[keyword] = 0; keywordList.push(keyword); }
      keywordCounts[keyword] += 1;
    });
  });

  keywordList.sort(function (a, b) {
    if (keywordCounts[b] !== keywordCounts[a]) { return keywordCounts[b] - keywordCounts[a]; }
    return a.localeCompare(b);
  });

  var topKeywords = keywordList.slice(0, 20).map(function (kw) {
    return { keyword: kw, count: keywordCounts[kw] };
  });

  var rareKeywords = keywordList.filter(function (kw) {
    return keywordCounts[kw] <= 2;
  }).map(function (kw) {
    return { keyword: kw, count: keywordCounts[kw] };
  });

  rareKeywords.sort(function (a, b) {
    if (a.count !== b.count) { return a.count - b.count; }
    return a.keyword.localeCompare(b.keyword);
  });

  return {
    totalResources:       resources.length,
    uniqueKeywords:       keywordList.length,
    resourcesWithKeywords: resourcesWithKeywords,
    missingKeywords:      missingKeywords,
    topKeywords:          topKeywords,
    rareKeywords:         rareKeywords,
    maxKeywordCount:      topKeywords.length ? topKeywords[0].count : 0,
    coverage: [
      { label: "No keywords",   count: zeroKw,       note: "resources with no keywords" },
      { label: "1–2 keywords",  count: oneTwo,        note: "resources with one or two keywords" },
      { label: "3–5 keywords",  count: threeToFive,   note: "resources with three to five keywords" },
      { label: "6+ keywords",   count: sixPlus,       note: "resources with six or more keywords" }
    ]
  };
}

// ---------------------------------------------------------------------------
// Escape helpers
// ---------------------------------------------------------------------------

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

  var match = String(dateValue).match(/^(\d{4})-(\d{2})/);

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
// URL / commons helpers
// ---------------------------------------------------------------------------

function getWikimediaPageUrl(wikiPageValue) {
  if (!wikiPageValue) { return ""; }

  var normalizedTitle = String(wikiPageValue).replace(/ /g, "_");

  return "https://meta.wikimedia.org/wiki/" + encodeURI(normalizedTitle);
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
