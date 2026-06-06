# Current Public Data Cache

This directory stores a broader current snapshot from MOSAIC's live public
sources. It complements the retrospective validation cache, where some older
public APIs no longer expose records for the exact outbreak windows.

Populate or refresh it with:

```bash
python scripts/fetch_current_data.py
```

Files are real public-source responses or compact lineage snapshots derived from
public Nextstrain trees. Do not replace empty source responses with synthetic
data.
