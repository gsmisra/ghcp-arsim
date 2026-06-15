from __future__ import annotations

from typing import Any

import requests

from config_loader import Config
from models.requirement import GeneratedTestCase, RequirementArtifact


class BridgeHttpGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.bridge_base_url = self.config.get("GHCP_BRIDGE_BASE_URL", "http://127.0.0.1:8765").rstrip("/")
        self.bridge_auth_token = self.config.get("GHCP_BRIDGE_AUTH_TOKEN", "").strip()
        self.timeout_seconds = self.config.get_int("GHCP_BRIDGE_TIMEOUT_SECONDS", 180)
        self.max_cases = self.config.get_int("GHCP_BRIDGE_MAX_CASES", 5)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        payload = self._build_prompt_payload(artifact)
        response_payload = self._call_bridge(payload)
        return self._to_test_cases(response_payload, artifact)

    def _call_bridge(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.bridge_auth_token:
            headers["Authorization"] = f"Bearer {self.bridge_auth_token}"

        response = requests.post(
            f"{self.bridge_base_url}/v1/generate",
            headers=headers,
            json=payload,
            timeout=self.timeout_seconds,
        )

        if response.status_code >= 400:
            bridge_error = "Unknown bridge error"
            try:
                bridge_error_payload = response.json()
                bridge_error = bridge_error_payload.get("error") or str(bridge_error_payload)
            except ValueError:
                bridge_error = response.text or bridge_error
            raise RuntimeError(f"GHCP bridge returned {response.status_code}: {bridge_error}")

        try:
            response_payload = response.json()
        except ValueError as error:
            raise RuntimeError(f"GHCP bridge returned invalid JSON: {error}") from error

        self._validate_test_cases_schema(response_payload)
        return response_payload

    def _build_prompt_payload(self, artifact: RequirementArtifact) -> dict[str, Any]:
        instruction_sections = [
            "SYSTEM ROLE:\nYou are an enterprise QE assistant generating grounded test cases from provided requirement context only.",
            (
                "OUTPUT CONTRACT:\n"
                "Return valid JSON only with top-level key 'test_cases'.\n"
                "Each item must include: scenario_name, objective, preconditions, steps, expected_results, tags, examples."
            ),
            "SELECTED SKILLS:\nUse skill hints from artifact.metadata.selected_skills when present.",
            "SELECTED INSTRUCTIONS:\nUse instruction hints from artifact.metadata.selected_instructions when present.",
            (
                "REQUIREMENT CONTEXT:\n"
                f"Source type: {artifact.source_type}\n"
                f"Title: {artifact.title}\n"
                "Use only this context and do not invent unsupported behavior."
            ),
        ]

        return {
            "instruction": "\n\n".join(instruction_sections),
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

        cases: list[GeneratedTestCase] = []
        for item in items[: self.max_cases]:
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

    def _validate_test_cases_schema(self, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise RuntimeError("GHCP bridge response must be a JSON object.")

        items = payload.get("test_cases")
        if not isinstance(items, list) or not items:
            raise RuntimeError("GHCP bridge response must include a non-empty 'test_cases' array.")

        required_array_fields = ("preconditions", "steps", "expected_results", "tags", "examples")
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise RuntimeError(f"test_cases[{index}] must be an object.")
            for field in ("scenario_name", "objective"):
                if not isinstance(item.get(field), str) or not item.get(field, "").strip():
                    raise RuntimeError(f"test_cases[{index}].{field} must be a non-empty string.")
            for field in required_array_fields:
                if not isinstance(item.get(field), list):
                    raise RuntimeError(f"test_cases[{index}].{field} must be an array.")