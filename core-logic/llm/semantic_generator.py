from __future__ import annotations

import json
import math
from typing import Any

import requests

from config_loader import Config
from models.requirement import GeneratedTestCase, RankedRequirementChunk, RequirementArtifact
from utils.io_utils import chunk_lines


class SemanticTestCaseGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.base_url = self.config.get("LLM_API_BASE_URL", "").rstrip("/")
        self.chat_path = self.config.get("LLM_CHAT_COMPLETIONS_PATH", "/v1/chat/completions")
        self.embedding_path = self.config.get("LLM_EMBEDDINGS_PATH", "/v1/embeddings")
        self.api_key = self.config.get("LLM_API_KEY", "")
        self.llm_model = self.config.get("LLM_MODEL", "")
        self.embedding_model = self.config.get("EMBEDDING_MODEL", "")
        self.timeout = self.config.get_int("LLM_TIMEOUT_SECONDS", 90)
        self.max_chunks = self.config.get_int("LLM_MAX_CHUNKS", 6)
        self.max_cases = self.config.get_int("LLM_MAX_CASES", 3)
        self.verify_tls = self.config.get_bool("VERIFY_TLS", True)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        if not self._is_configured():
            return []

        chunks = self._build_chunks(artifact.raw_text)
        if not chunks:
            return []

        ranked_chunks = self._rank_chunks(
            chunks,
            f"Generate detailed QE test cases for {artifact.source_type} requirement {artifact.title}",
        )
        prompt_context = "\n\n".join(item.text for item in ranked_chunks[: self.max_chunks])

        completion_payload = {
            "model": self.llm_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an enterprise QE analyst. Generate semantically grounded test cases only from the supplied requirement context. "
                        "Return strict JSON with key 'test_cases'. Each test case must contain scenario_name, objective, preconditions, steps, expected_results, tags, and examples. "
                        "Do not invent functionality not present in the requirement context."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Requirement title: {artifact.title}\n"
                        f"Source type: {artifact.source_type}\n"
                        f"Maximum test cases: {self.max_cases}\n"
                        f"Context:\n{prompt_context}"
                    ),
                },
            ],
        }

        response = self._post_json(self.chat_path, completion_payload)
        content = response["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        return self._to_test_cases(parsed.get("test_cases", []), artifact)

    def _is_configured(self) -> bool:
        return all([self.base_url, self.api_key, self.llm_model, self.embedding_model])

    def _build_chunks(self, raw_text: str) -> list[str]:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        return chunk_lines(lines, size=20)

    def _rank_chunks(self, chunks: list[str], query: str) -> list[RankedRequirementChunk]:
        embeddings = self._embed([query] + chunks)
        if not embeddings or len(embeddings) != len(chunks) + 1:
            return [RankedRequirementChunk(text=chunk, score=0.0) for chunk in chunks]

        query_embedding = embeddings[0]
        ranked: list[RankedRequirementChunk] = []
        for chunk, embedding in zip(chunks, embeddings[1:]):
            ranked.append(
                RankedRequirementChunk(
                    text=chunk,
                    score=self._cosine_similarity(query_embedding, embedding),
                )
            )
        return sorted(ranked, key=lambda item: item.score, reverse=True)

    def _embed(self, inputs: list[str]) -> list[list[float]]:
        payload = {
            "model": self.embedding_model,
            "input": inputs,
        }
        response = self._post_json(self.embedding_path, payload)
        data = response.get("data", [])
        return [item.get("embedding", []) for item in data]

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=self.timeout,
            verify=self.verify_tls,
        )
        response.raise_for_status()
        return response.json()

    def _cosine_similarity(self, left: list[float], right: list[float]) -> float:
        numerator = sum(a * b for a, b in zip(left, right))
        left_norm = math.sqrt(sum(a * a for a in left))
        right_norm = math.sqrt(sum(b * b for b in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return numerator / (left_norm * right_norm)

    def _to_test_cases(
        self,
        items: list[dict[str, Any]],
        artifact: RequirementArtifact,
    ) -> list[GeneratedTestCase]:
        test_cases: list[GeneratedTestCase] = []
        for item in items[: self.max_cases]:
            test_cases.append(
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
        return test_cases