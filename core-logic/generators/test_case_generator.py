from __future__ import annotations

import json
import re

from config_loader import Config
from llm.semantic_generator import SemanticTestCaseGenerator
from models.requirement import GeneratedTestCase, RequirementArtifact


class TestCaseGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.semantic_generator = SemanticTestCaseGenerator(config)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        generation_mode = self.config.get("DEFAULT_GENERATION_MODE", "semantic_llm")
        if generation_mode == "semantic_llm":
            semantic_cases = self.semantic_generator.generate(artifact)
            if semantic_cases:
                return semantic_cases

        lines = self._extract_requirement_lines(artifact.raw_text)

        objective = self._extract_objective(lines)
        domains = self._extract_domains(artifact.raw_text)
        scenario_names = self._build_scenario_names(artifact.title, domains)

        cases: list[GeneratedTestCase] = []
        for idx, scenario_name in enumerate(scenario_names, start=1):
            tags = [
                "qe",
                artifact.source_type,
                "regression",
                f"priority_p{1 if idx == 1 else 2}",
            ] + domains[:2]

            evidence = self._select_scenario_evidence(lines, idx)
            preconditions = self._build_preconditions(evidence, lines)
            steps = self._build_steps(evidence, lines)
            expected = self._build_expected_results(evidence, lines)
            examples = self._build_examples(evidence, artifact, idx)

            cases.append(
                GeneratedTestCase(
                    scenario_name=scenario_name,
                    objective=objective,
                    preconditions=preconditions,
                    steps=steps,
                    expected_results=expected,
                    tags=tags,
                    examples=examples,
                )
            )
        return cases

    def _extract_requirement_lines(self, raw_text: str) -> list[str]:
        lines: list[str] = []
        for raw_line in raw_text.splitlines():
            line = re.sub(r"\s+", " ", raw_line.strip())
            line = re.sub(r"^[#\-*\d\.)\s]+", "", line)
            if not line:
                continue
            if line.lower() in {"description:", "comments:", "acceptance criteria:"}:
                continue
            lines.append(line)
        return lines

    def _extract_objective(self, lines: list[str]) -> str:
        objective_markers = ["objective", "summary", "description", "goal"]
        for line in lines[:40]:
            lowered = line.lower()
            if any(marker in lowered for marker in objective_markers):
                return line
        return lines[0] if lines else "Requirement objective not available from source content."

    def _extract_domains(self, text: str) -> list[str]:
        candidates = {
            "payments": r"payment|transfer|settlement",
            "accounts": r"account|customer|profile",
            "cards": r"card|debit|credit",
            "loans": r"loan|emi|repayment",
            "security": r"auth|token|role|permission|mfa",
            "compliance": r"audit|regulatory|kyc|aml",
        }
        found = [name for name, pattern in candidates.items() if re.search(pattern, text, flags=re.I)]
        return found or ["banking"]

    def _build_scenario_names(self, title: str, domains: list[str]) -> list[str]:
        normalized = title.replace("_", " ").strip()
        primary = domains[0] if domains else "business"
        return [
            f"Validate {normalized} happy path for {primary}",
            f"Validate {normalized} boundary and validation controls",
            f"Validate {normalized} failure handling and observability",
        ]

    def _select_scenario_evidence(self, lines: list[str], scenario_index: int) -> list[str]:
        scenario_keywords = {
            1: ["success", "valid", "happy", "create", "submit", "process", "save", "complete"],
            2: ["validate", "mandatory", "required", "boundary", "format", "field", "rule", "limit"],
            3: ["error", "fail", "reject", "invalid", "exception", "timeout", "unauthorized", "deny"],
        }
        keywords = scenario_keywords.get(scenario_index, [])

        matching = [
            line for line in lines
            if any(keyword in line.lower() for keyword in keywords)
        ]

        if len(matching) >= 3:
            return matching[:6]

        fallback = []
        for line in lines:
            if line not in matching:
                fallback.append(line)
            if len(matching) + len(fallback) >= 6:
                break
        return (matching + fallback)[:6]

    def _build_preconditions(self, evidence: list[str], lines: list[str]) -> list[str]:
        keywords = ("precondition", "before", "available", "configured", "access", "role", "login", "exists")
        preconditions = [line for line in evidence if any(keyword in line.lower() for keyword in keywords)]

        if not preconditions:
            preconditions = [line for line in lines[:2]]

        return preconditions[:3] or ["Requirement source did not expose explicit preconditions."]

    def _build_steps(self, evidence: list[str], lines: list[str]) -> list[str]:
        action_keywords = (
            "navigate", "open", "enter", "select", "upload", "submit", "search", "create",
            "update", "read", "capture", "invoke", "process", "click", "provide", "choose",
        )
        steps = [line for line in evidence if any(keyword in line.lower() for keyword in action_keywords)]

        if not steps:
            steps = evidence[:4] or lines[:4]

        return steps[:5] or ["Requirement source did not expose executable test steps."]

    def _build_expected_results(self, evidence: list[str], lines: list[str]) -> list[str]:
        expected_keywords = (
            "should", "must", "then", "display", "return", "result", "saved", "created",
            "updated", "rejected", "error", "success", "status", "message",
        )
        expected = [line for line in evidence if any(keyword in line.lower() for keyword in expected_keywords)]

        if not expected:
            expected = [line for line in lines if any(keyword in line.lower() for keyword in expected_keywords)]

        if not expected:
            expected = evidence[-2:] if len(evidence) >= 2 else evidence

        return expected[:4] or ["Requirement source did not expose explicit expected results."]

    def _build_examples(
        self,
        evidence: list[str],
        artifact: RequirementArtifact,
        scenario_index: int,
    ) -> list[dict]:
        examples: list[dict] = []
        for line in evidence:
            if "|" in line:
                parts = [part.strip() for part in line.split("|") if part.strip()]
            elif "," in line:
                parts = [part.strip() for part in line.split(",") if part.strip()]
            else:
                continue

            if len(parts) < 2:
                continue

            example = {f"value_{idx}": part for idx, part in enumerate(parts[:4], start=1)}
            examples.append(example)
            if len(examples) >= 3:
                break

        if examples:
            return examples

        sample_text = evidence[0] if evidence else artifact.title
        return [
            {
                "source_type": artifact.source_type,
                "scenario_focus": f"scenario_{scenario_index}",
                "reference": sample_text[:80],
            }
        ]
