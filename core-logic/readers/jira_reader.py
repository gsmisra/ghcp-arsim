from __future__ import annotations

from pathlib import Path

import requests

from config_loader import Config
from readers.document_reader import DocumentReader
from models.requirement import RequirementArtifact


class JiraReader:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.base_url = self.config.get("JIRA_BASE_URL").rstrip("/")
        self.issue_api_path = self.config.get("JIRA_API_PATH", "/rest/api/3/issue")
        self.comment_api_suffix = self.config.get("JIRA_COMMENT_API_SUFFIX", "/comment")
        self.auth = (
            self.config.get("JIRA_EMAIL"),
            self.config.get("JIRA_API_TOKEN"),
        )
        self.verify_tls = self.config.get_bool("VERIFY_TLS", True)
        self.temp_dir = Path(self.config.get("APP_TEMP_UPLOAD_DIR", "temp_uploads")) / "jira_attachments"
        self.max_attachment_bytes = self.config.get_int("JIRA_MAX_ATTACHMENT_BYTES", 10485760)
        self.document_reader = DocumentReader()

    def read_stories(
        self,
        story_ids: list[str],
        username: str | None = None,
        password: str | None = None,
    ) -> list[RequirementArtifact]:
        auth = self._resolve_auth(username, password)
        artifacts: list[RequirementArtifact] = []
        for story_id in story_ids:
            issue = self._fetch_issue(story_id, auth)
            fields = issue.get("fields", {})
            title = fields.get("summary", story_id)
            description = self._flatten_description(fields.get("description"))
            acceptance = fields.get("customfield_10000", "")
            comments = self._fetch_comments(story_id, auth)
            attachments = self._fetch_attachments_text(story_id, fields.get("attachment", []), auth)

            text_parts = [
                f"Story ID: {story_id}",
                f"Summary: {title}",
                "Description:",
                description,
                "Acceptance Criteria:",
                str(acceptance),
                "Comments:",
                comments,
                "Attachments:",
                attachments,
            ]

            artifacts.append(
                RequirementArtifact(
                    source_type="jira",
                    title=f"{story_id}_{title}".replace(" ", "_"),
                    raw_text="\n".join(text_parts),
                    metadata={"story_id": story_id, "raw_issue": issue},
                )
            )
        return artifacts

    def _resolve_auth(self, username: str | None, password: str | None) -> tuple[str, str]:
        if username and password:
            return username, password
        return self.auth

    def _fetch_issue(self, story_id: str, auth: tuple[str, str]) -> dict:
        url = f"{self.base_url}{self.issue_api_path}/{story_id}"
        response = requests.get(url, auth=auth, timeout=45, verify=self.verify_tls)
        response.raise_for_status()
        return response.json()

    def _fetch_comments(self, story_id: str, auth: tuple[str, str]) -> str:
        url = f"{self.base_url}{self.issue_api_path}/{story_id}{self.comment_api_suffix}"
        response = requests.get(url, auth=auth, timeout=45, verify=self.verify_tls)
        if response.status_code >= 400:
            return ""
        payload = response.json()
        comments = payload.get("comments", [])
        flattened = []
        for comment in comments:
            body = self._flatten_description(comment.get("body"))
            if body.strip():
                flattened.append(body)
        return "\n\n".join(flattened)

    def _fetch_attachments_text(self, story_id: str, attachments: list[dict], auth: tuple[str, str]) -> str:
        if not attachments:
            return ""

        self.temp_dir.mkdir(parents=True, exist_ok=True)
        supported = {".docx", ".xlsx", ".pdf", ".csv"}
        parts: list[str] = []

        for item in attachments:
            file_name = str(item.get("filename", "")).strip()
            content_url = str(item.get("content", "")).strip()
            size = int(item.get("size", 0) or 0)

            suffix = Path(file_name).suffix.lower()
            if suffix not in supported or not content_url:
                continue
            if size > self.max_attachment_bytes:
                parts.append(f"Attachment skipped due to size limit: {file_name}")
                continue

            local_name = f"{story_id}_{Path(file_name).name}"
            local_path = self.temp_dir / local_name
            try:
                response = requests.get(content_url, auth=auth, timeout=60, verify=self.verify_tls)
                response.raise_for_status()
                local_path.write_bytes(response.content)
                parsed = self.document_reader.read(str(local_path)).raw_text
                parts.append(f"Attachment: {file_name}\n{parsed}")
            except Exception as ex:
                parts.append(f"Attachment read failed: {file_name} ({ex})")

        return "\n\n".join(parts)

    def _flatten_description(self, description: object) -> str:
        if description is None:
            return ""
        if isinstance(description, str):
            return description
        if isinstance(description, dict):
            return self._flatten_adf(description)
        return str(description)

    def _flatten_adf(self, node: dict) -> str:
        parts: list[str] = []

        def walk(item: object) -> None:
            if isinstance(item, dict):
                if "text" in item and isinstance(item["text"], str):
                    parts.append(item["text"])
                for child in item.get("content", []):
                    walk(child)
                if item.get("type") in {"paragraph", "heading", "listItem"}:
                    parts.append("\n")
            elif isinstance(item, list):
                for child in item:
                    walk(child)

        walk(node)
        return "".join(parts).strip()
