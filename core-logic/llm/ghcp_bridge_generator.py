from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from config_loader import Config
from models.requirement import GeneratedTestCase, RequirementArtifact


class GHCPBridgeGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.command_template = self.config.get("GHCP_BRIDGE_COMMAND", "").strip()
        self.timeout_seconds = self.config.get_int("GHCP_BRIDGE_TIMEOUT_SECONDS", 180)
        self.max_cases = self.config.get_int("GHCP_BRIDGE_MAX_CASES", 5)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        if not self.command_template:
            raise RuntimeError("GHCP bridge is not configured. Set GHCP_BRIDGE_COMMAND.")

        with tempfile.TemporaryDirectory(prefix="ghcp_bridge_") as temp_dir:
            temp_path = Path(temp_dir)
            prompt_path = temp_path / "prompt.json"
            response_path = temp_path / "response.json"

            payload = self._build_prompt_payload(artifact)
            prompt_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

            command = (
                self.command_template
                .replace("{prompt_file}", str(prompt_path))
                .replace("{response_file}", str(response_path))
            )

            process = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
            if process.returncode != 0:
                stderr = process.stderr.strip() or "Unknown bridge command failure"
                raise RuntimeError(f"GHCP bridge command failed: {stderr}")

            self._wait_for_response_file(response_path)
            response_raw = response_path.read_text(encoding="utf-8-sig")
            try:
                response_payload = json.loads(response_raw)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"GHCP bridge returned invalid JSON: {error}") from error
            return self._to_test_cases(response_payload, artifact)

    def _wait_for_response_file(self, path: Path) -> None:
        deadline = time.time() + self.timeout_seconds
        while time.time() < deadline:
            if path.exists() and path.is_file() and path.stat().st_size > 0:
                return
            time.sleep(0.4)
        raise RuntimeError("Timed out waiting for GHCP bridge response file.")

    def _build_prompt_payload(self, artifact: RequirementArtifact) -> dict[str, Any]:
        instruction = (
            "Generate enterprise QE test cases ONLY from the provided requirement context. "
            "Return strict JSON with key 'test_cases'. Each item must include: "
            "scenario_name, objective, preconditions, steps, expected_results, tags, examples. "
            "Do not invent features outside context."
        )
        return {
            "instruction": instruction,
            "max_cases": self.max_cases,
            "artifact": {
                "source_type": artifact.source_type,
                "title": artifact.title,
                "raw_text": artifact.raw_text,
                "metadata": artifact.metadata,
            },
        }

    def _to_test_cases(
        self,
        payload: dict[str, Any],
        artifact: RequirementArtifact,
    ) -> list[GeneratedTestCase]:
        items = payload.get("test_cases", [])
        if not isinstance(items, list):
            raise RuntimeError("GHCP bridge response must include a list under 'test_cases'.")

        cases: list[GeneratedTestCase] = []
        for item in items[: self.max_cases]:
            if not isinstance(item, dict):
                continue

            cases.append(
                GeneratedTestCase(
                    scenario_name=str(item.get("scenario_name", artifact.title)),
                    objective=str(item.get("objective", artifact.title)),
                    preconditions=[str(x) for x in item.get("preconditions", []) if str(x).strip()],
                    steps=[str(x) for x in item.get("steps", []) if str(x).strip()],
                    expected_results=[str(x) for x in item.get("expected_results", []) if str(x).strip()],
                    tags=[str(x) for x in item.get("tags", []) if str(x).strip()],
                    examples=[example for example in item.get("examples", []) if isinstance(example, dict)],
                )
            )

        if not cases:
            raise RuntimeError("GHCP bridge returned no test cases.")
        return cases
