# Controlled locality catalog — E2.2

This is a deliberately limited independently sourced catalog, not worldwide coverage.
It contains **six localities in three countries**: Bogotá and Medellín (COL),
Ankara and Istanbul (TUR), and two separate Springfields (USA, admin1 IL/MA).
Country labels/codes are the corresponding GeoNames countryInfo values. Codes
are alpha-3 in the API; GeoNames city alpha-2 values were mapped via countryInfo.
Other country codes are unsupported by this initial snapshot (400); a supported
country with no query matches returns an empty page, never a fabricated Place.

Source: [GeoNames](https://www.geonames.org/),
[cities15000.zip](https://download.geonames.org/export/dump/cities15000.zip),
[countryInfo.txt](https://download.geonames.org/export/dump/countryInfo.txt),
[readme/license declaration](https://download.geonames.org/export/dump/readme.txt).
Retrieved 2026-11-04. Licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Attribution: GeoNames, https://www.geonames.org/. No endorsement is implied;
GeoNames provides the data without an accuracy/completeness guarantee.

`geonames-subset.json` records the selected IDs/fields, transformations, retrieval
date and SHA-256 hashes of all three downloaded source artifacts. Full downloads
remain ignored in `.local/e22-geonames/`; the selected data snapshot is included
as project source, and the same rows are embedded in migration 0004. The daily upstream
dump may change; future downloads need explicit review, never an automatic
runtime refresh or modification of an applied migration.

Selection by source ID (not text matching at runtime): 3688689, 3674962, 323786,
745044, 4250542, 4951788. Stable UUIDs are UUIDv5 with the standard URL namespace
and input `https://www.geonames.org/<geonameid>`. City text is not unique. A scoped
unique `(source_provider,source_id)` prevents duplicates of the same source entity;
no rule merges independently identified homonyms or aliases. A different source
would require reviewed identity mapping, not UUID/name guesswork.

Changes to the source: retain only these six populated-locality entries and three
country references; preserve UTF-8 names; use GeoNames admin1 **codes**, not invented
region names; round independent WGS84 coordinates to two decimal places as
approximate catalog marker points; omit aliases, population and unrelated source
fields. These points are neither city boundaries nor the user's precise location.
API `region` currently contains that provider admin1 code, suitable for disambiguation
but not a localized region label. No private Visit coordinates or EXIF enter this
catalog. No web service, API key, paid dependency or request-time geocoder is used.

To reproduce selection from the archived city text, use the IDs above, read fields
0 (id), 1 (name), 4/5 (latitude/longitude), 8 (alpha-2), 10 (admin1), map country
fields 0/1/4 (alpha-2/alpha-3/name), and compute UUIDv5 as specified. Compare the
result with the checked-in subset and migration; integration tests assert their
identity/coordinate agreement. Expanding coverage is a reviewed catalog migration,
with license/provenance validation and stable existing IDs, not user-created Places.

No inline-place resolver is enabled: the client selects an explicit UUID from
catalog candidates. Ambiguous names return distinct candidates; unknown IDs/inline
names on Visit creation return 400. There is no automatic global creation from
Visit text. Countries/localities outside this subset remain a documented coverage
limit, not an inference from private travel data.
