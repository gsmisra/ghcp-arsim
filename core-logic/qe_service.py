from __future__ import annotations

from pathlib import Path

from config_loader import Config
from generators.bdd_generator import BDDGenerator
from generators.jira_csv_generator import JiraCsvGenerator
from generators.test_case_generator import TestCaseGenerator
from models.requirement import RequirementArtifact
from readers.confluence_reader import ConfluenceReader
from readers.document_reader import DocumentReader
from readers.jira_reader import JiraReader
from utils.io_utils import ensure_output_dir


class QEAgenticPlatformService:
    def __init__(self, config_path: str = "app_config.properties") -> None:
        self.config = Config(config_path)
        self.temp_upload_dir = self.config.get("APP_TEMP_UPLOAD_DIR", "temp_uploads")
        self.document_reader = DocumentReader()
        self.confluence_reader = ConfluenceReader(self.config)
        self.jira_reader = JiraReader(self.config)
        self.test_case_generator = TestCaseGenerator(self.config)
        self.bdd_generator = BDDGenerator(self.config)
        self.jira_csv_generator = JiraCsvGenerator(self.config)

    def process_document(self, file_path: str, output_format: str) -> list[Path]:
        artifact = self.document_reader.read(file_path)
        return self._generate_outputs([artifact], output_format)

    def process_confluence(
        self,
        url_or_page_id: str,
        output_format: str,
        username: str | None = None,
        password: str | None = None,
    ) -> list[Path]:
        content = self.confluence_reader.read_recursive(
            url_or_page_id,
            working_dir=self.temp_upload_dir,
            username=username,
            password=password,
        )
        artifact = RequirementArtifact(
            source_type="confluence",
            title="confluence_requirement",
            raw_text=content,
            metadata={"source": url_or_page_id},
        )
        return self._generate_outputs([artifact], output_format)

    def process_jira(
        self,
        story_ids: list[str],
        output_format: str,
        username: str | None = None,
        password: str | None = None,
    ) -> list[Path]:
        artifacts = self.jira_reader.read_stories(
            story_ids,
            username=username,
            password=password,
        )
        return self._generate_outputs(artifacts, output_format)

    def _generate_outputs(
        self, artifacts: list[RequirementArtifact], output_format: str
    ) -> list[Path]:
        output_dir = ensure_output_dir(self.config.get("APP_OUTPUT_DIR", "output"))
        outputs: list[Path] = []

        for artifact in artifacts:
            cases = self.test_case_generator.generate(artifact)
            if output_format.lower() == "bdd":
                outputs.append(self.bdd_generator.write_feature_file(artifact, cases, output_dir))
            elif output_format.lower() == "jira_csv":
                outputs.append(self.jira_csv_generator.write_csv(artifact, cases, output_dir))
            else:
                raise ValueError("Unsupported output format. Use 'bdd' or 'jira_csv'.")

        return outputs
