# Gold-Standard Benchmark Corpora

These files contain annotated ground-truth data for evaluating the MOSAIC LLM extractor
(MOSAIC paper §4.4 — Hallucination Quantification).

## consoli_171.json
171 annotated ProMED/WHO DON samples with ground-truth fields:
  - `pathogen`, `country`, `date`, `case_count`

Source: Consoli et al. (2024). "Epidemic information extraction for event-based
surveillance using large language models." ICICT, LNNS. arXiv:2408.14277.

**This file is NOT included in the repository** to respect the original data licence.
Download instructions:
```bash
# Request access from the original authors:
# https://arxiv.org/abs/2408.14277
# Place the file as: data/gold/consoli_171.json
```

## eventepi_506.json
506 Incident Database records from the WHO EIOS system with multi-annotator
consensus labels (EventEpi corpus).

Source: WHO EIOS EventEpi corpus (upon request).

**This file is NOT included in the repository.**
Download instructions:
```bash
# Request access from: https://www.who.int/initiatives/eios
# Place the file as: data/gold/eventepi_506.json
```

## Running the benchmark
Once the corpus files are in place:
```bash
python -m mosaic_core.extract.benchmark --corpus consoli
python -m mosaic_core.extract.benchmark --corpus eventepi
```

This produces F1, ECE, and H_count metrics per field as described in the paper.
