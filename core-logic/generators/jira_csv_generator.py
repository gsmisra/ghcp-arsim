from __future__ import annotations

import csv
from pathlib import Path

from config_loader import Config
from models.requirement import GeneratedTestCase, RequirementArtifact
from utils.io_utils import sanitize_filename


class JiraCsvGenerator:
    HEADERS = [
        "Summary",
        "Issue Type",
        "Description",
        "Priority",
        "Labels",
        "Preconditions",
        "Test Steps",
        "Expected Result",
    ]

    def __init__(self, config: Config) -> None:
        self.config = config

    def write_csv(
        self,
        artifact: RequirementArtifact,
        test_cases: list[GeneratedTestCase],
        output_dir: Path,
    ) -> Path:
        file_name = f"{sanitize_filename(artifact.title)}_jira_testcases.csv"
        output_path = output_dir / file_name

        with output_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.HEADERS)
            writer.writeheader()

            for case in test_cases:
                writer.writerow(
                    {
                        "Summary": case.scenario_name,
                        "Issue Type": self.config.get("JIRA_CSV_ISSUE_TYPE", "Test"),
                        "Description": case.objective,
                        "Priority": self.config.get("JIRA_CSV_PRIORITY", "High"),
                        "Labels": ",".join(case.tags),
                        "Preconditions": "\n".join(case.preconditions),
                        "Test Steps": "\n".join(
                            f"{idx}. {step}" for idx, step in enumerate(case.steps, start=1)
                        ),
                        "Expected Result": "\n".join(case.expected_results),
                    }
                )

        return output_path
