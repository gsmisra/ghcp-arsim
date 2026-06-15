from dataclasses import dataclass, field
from typing import List


@dataclass
class RequirementArtifact:
    source_type: str
    title: str
    raw_text: str
    metadata: dict = field(default_factory=dict)


@dataclass
class GeneratedTestCase:
    scenario_name: str
    objective: str
    preconditions: List[str]
    steps: List[str]
    expected_results: List[str]
    tags: List[str]
    examples: List[dict] = field(default_factory=list)
