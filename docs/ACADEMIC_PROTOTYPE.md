# Academic Career prototype

This fork-local prototype connects academic job discovery and academic CV output to one private YAML master record without changing career-ops' existing user files.

## Principle

```text
config/academic-profile.yml
        │
        ├── targets ──► data/academic/portals.yml ──► scan.mjs
        │                                      └──► data/academic/pipeline.md
        │
        └── academic record ──► classic academic HTML/PDF
                                output/academic/
```

The master record is private and gitignored. Generated search configuration, pipelines, HTML, and PDFs are disposable artifacts.

## First run

```bash
node academic.mjs init
# edit config/academic-profile.yml
node academic.mjs validate
node academic.mjs portals
node academic.mjs scan --dry-run
node academic.mjs cv --lang=en --pdf
```

For a Traditional Chinese CV:

```bash
node academic.mjs cv --lang=zh-TW --pdf
```

By default, `planned`, `in_preparation`, `submitted`, and `under_review` records are excluded from the CV. To inspect a working version that includes them:

```bash
node academic.mjs cv --lang=en --include-wip
```

## Discovery lane

`academic.mjs scan` delegates to the existing `scan.mjs`; it does not fork the scanner. It sets career-ops' already-supported path overrides so the academic lane has its own:

- `CAREER_OPS_PORTALS` → `data/academic/portals.yml`
- `CAREER_OPS_PIPELINE` → `data/academic/pipeline.md`
- `CAREER_OPS_SCAN_HISTORY` → `data/academic/scan-history.tsv`

The root `portals.yml` and the ordinary career pipeline are untouched.

The example enables the existing `higheredjobs` provider. Future EURAXESS, JREC-IN, and Galaxie providers can be added to `targets.job_boards` while keeping the same master record and workflow.

## CV design

The prototype deliberately avoids branded colors and tech-resume styling. The `academic-classic` template uses black type on white paper, a restrained book-serif stack, fine rules, generous vertical rhythm, and bibliography-friendly entries. No font files are bundled.

The data model is renderer-independent. Once the content flow is stable, `academic-profile.yml` can be adapted to RenderCV or Typst without changing the search layer.

## Scope of this prototype

Included now:

- one academic master YAML;
- status-aware CV selection;
- multilingual display fields;
- academic title filtering using career-ops' existing AND-group syntax;
- HigherEdJobs through the provider already in this fork;
- a separate academic scan/pipeline lane;
- HTML and A4 PDF output through the Playwright dependency already present in career-ops.

Deferred until the prototype proves useful:

- EURAXESS / JREC-IN / Galaxie providers;
- job-specific CV section selection and reordering;
- evidence/provenance attachments;
- CNU / MCF / CNRS / Taiwan-specific application packages;
- RenderCV/Typst adapters;
- ORCID/OpenAlex imports.
