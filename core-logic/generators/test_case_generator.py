from __future__ import annotations

from config_loader import Config
from llm.ghcp_bridge_generator import GHCPBridgeGenerator
from models.requirement import GeneratedTestCase, RequirementArtifact


class TestCaseGenerator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.ghcp_bridge_generator = GHCPBridgeGenerator(config)

    def generate(self, artifact: RequirementArtifact) -> list[GeneratedTestCase]:
        # The platform is intentionally GHCP-only.
        return self.ghcp_bridge_generator.generate(artifact)
