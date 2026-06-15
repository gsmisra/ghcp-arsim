from __future__ import annotations

from config_loader import Config
from llm.bridge_http_generator import BridgeHttpGenerator
from models.requirement import GeneratedTestCase, RequirementArtifact


class TestCaseGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.bridge_http_generator = BridgeHttpGenerator(config)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        # The platform is intentionally GHCP-only.
        return self.bridge_http_generator.generate(artifact)
