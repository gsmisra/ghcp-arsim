from __future__ import annotations

from pathlib import Path

from config_loader import Config
from models.requirement import GeneratedTestCase, RequirementArtifact
from utils.io_utils import sanitize_filename


class BDDGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config

    def write_feature_file(
        self,
        artifact: RequirementArtifact,
        test_cases: list[GeneratedTestCase],
        output_dir: Path,
    ) -> Path:
        filename = f"{sanitize_filename(artifact.title)}.feature"
        output_path = output_dir / filename

        shared_background = self._extract_shared_preconditions(test_cases)

        feature_lines = [
            f"@qe @enterprise @{artifact.source_type}",
            f"Feature: {artifact.title.replace('_', ' ').title()}",
            f"  {self.config.get('BDD_FEATURE_ROLE_LINE', 'As a QE engineer in banking delivery')}",
            f"  {self.config.get('BDD_FEATURE_GOAL_LINE', test_cases[0].objective if test_cases else artifact.title)}",
            f"  {self.config.get('BDD_FEATURE_VALUE_LINE', 'So that business critical workflows remain reliable and compliant')}",
            "",
        ]

        if shared_background:
            feature_lines.append("  Background:")
            for index, step in enumerate(shared_background):
                keyword = "Given" if index == 0 else "And"
                feature_lines.append(f"    {keyword} {step}")
            feature_lines.append("")

        for case in test_cases:
            tags = " ".join([f"@{tag}" for tag in case.tags])
            feature_lines.append(f"  {tags}")
            feature_lines.append(f"  Scenario Outline: {case.scenario_name}")
            scenario_preconditions = [
                item for item in case.preconditions
                if item not in shared_background
            ]

            for index, step in enumerate(scenario_preconditions):
                keyword = "Given" if index == 0 else "And"
                feature_lines.append(f"    {keyword} {step}")

            for index, step in enumerate(case.steps):
                keyword = "When" if index == 0 and not scenario_preconditions else "And"
                feature_lines.append(f"    {keyword} {step}")

            for index, step in enumerate(case.expected_results):
                keyword = "Then" if index == 0 else "And"
                feature_lines.append(f"    {keyword} {step}")

            if case.examples:
                feature_lines.append("")
                feature_lines.append("    Examples:")

                columns = list(case.examples[0].keys())
                feature_lines.append("      | " + " | ".join(columns) + " |")
                for example in case.examples:
                    row = [str(example.get(col, "")) for col in columns]
                    feature_lines.append("      | " + " | ".join(row) + " |")

            feature_lines.append("")

        output_path.write_text("\n".join(feature_lines), encoding="utf-8")
        return output_path

    def _extract_shared_preconditions(
        self,
        test_cases: list[GeneratedTestCase],
    ) -> list[str]:
        if not test_cases:
            return []

        common = set(test_cases[0].preconditions)
        for case in test_cases[1:]:
            common &= set(case.preconditions)

        return [item for item in test_cases[0].preconditions if item in common]
