"""Compute empirical FAR/FRR and latency from consented evaluation scores.

Input CSV columns: same_person (0/1), cosine_score, latency_ms.
Produces evidence, never automatically enables an operational policy.
"""
import argparse
import csv
import json
import numpy as np


def evaluate(rows, threshold):
    genuine = [float(r["cosine_score"]) for r in rows if r["same_person"] == "1"]
    impostors = [float(r["cosine_score"]) for r in rows if r["same_person"] == "0"]
    if not genuine or not impostors:
        raise ValueError("Both genuine and impostor pairs are required")
    return {"genuine_pairs": len(genuine), "impostor_pairs": len(impostors), "threshold": threshold,
            "far": sum(s >= threshold for s in impostors) / len(impostors),
            "frr": sum(s < threshold for s in genuine) / len(genuine),
            "latency_p95_ms": float(np.percentile([float(r["latency_ms"]) for r in rows], 95)),
            "production_approved": False, "note": "Observed sample rates only; no population accuracy guarantee"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("csv")
    parser.add_argument("--threshold", type=float, required=True)
    args = parser.parse_args()
    with open(args.csv, newline="", encoding="utf8") as source:
        print(json.dumps(evaluate(list(csv.DictReader(source)), args.threshold), indent=2))
