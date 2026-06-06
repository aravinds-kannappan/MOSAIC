"""
MOSAIC — Multi-Modal Open Surveillance with AI-Driven Calibrated Inference
==========================================================================

A multi-modal Bayesian disease intelligence system that:
1. Extracts structured epidemiological events from free-text outbreak reports
   using schema-constrained LLMs (Layer 1 — LLM Signal Extractor)
2. Applies Bayesian change-point detection to each surveillance stream
   (Layer 2 — BOCPD on text, BEAST on wastewater, KL-divergence on genomics)
3. Fuses all three streams via a hierarchical Bayesian renewal-equation model
   (Layer 3 — Multi-Modal Bayesian Hierarchical Fusion)
4. Produces calibrated posterior estimates of R_t and outbreak probability
   (Layer 4 — Calibrated Output and Dashboard)

Ref: MOSAIC research proposal, AIxBio Hackathon 2026
License: MIT
"""

__version__ = "0.1.0"
__author__ = "MOSAIC Contributors"
