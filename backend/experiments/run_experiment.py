from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.simulation import Experiment


def main() -> None:
    parser = argparse.ArgumentParser(description="Run NEXUS director comparison experiments")
    parser.add_argument("--seeds", type=int, default=100)
    parser.add_argument("--cycles", type=int, default=15)
    parser.add_argument("--round-seconds", type=float, default=8.0)
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parent / "results")
    parser.add_argument("--no-charts", action="store_true")
    args = parser.parse_args()

    experiment = Experiment(
        seeds=list(range(args.seeds)),
        cycles=args.cycles,
        round_seconds=args.round_seconds,
        output_dir=args.output_dir,
        include_charts=not args.no_charts,
    )
    paths = experiment.run()
    print(f"matches: {len(experiment.seeds) * len(Experiment.DIRECTORS) * len(Experiment.TEAM_LEVELS)}")
    for name, path in paths.items():
        print(f"{name}: {path}")


if __name__ == "__main__":
    main()
