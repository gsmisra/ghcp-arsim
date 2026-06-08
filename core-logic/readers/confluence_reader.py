from __future__ import annotations

import re
from collections import deque
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from config_loader import Config
from readers.document_reader import DocumentReader


class ConfluenceReader:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.base_url = self.config.get("CONFLUENCE_BASE_URL").rstrip("/")
        self.api_path = self.config.get("CONFLUENCE_API_PATH", "/rest/api/content")
        self.child_page_suffix = self.config.get("CONFLUENCE_CHILD_PAGE_SUFFIX", "/child/page")
        self.attachment_suffix = self.config.get("CONFLUENCE_ATTACHMENT_SUFFIX", "/child/attachment")
        self.auth = (
            self.config.get("CONFLUENCE_EMAIL"),
            self.config.get("CONFLUENCE_API_TOKEN"),
        )
        self.verify_tls = self.config.get_bool("VERIFY_TLS", True)
        self.max_depth = self.config.get_int("MAX_CONFLUENCE_DEPTH", 5)
        self.document_reader = DocumentReader()

    def read_recursive(
        self,
        url_or_page_id: str,
        working_dir: str = "temp_uploads",
        username: str | None = None,
        password: str | None = None,
    ) -> str:
        auth = self._resolve_auth(username, password)
        start_page_id = self._extract_page_id(url_or_page_id)
        queue = deque([(start_page_id, 0)])
        visited = set()
        all_content: list[str] = []
        work_path = Path(working_dir)
        work_path.mkdir(parents=True, exist_ok=True)

        while queue:
            page_id, depth = queue.popleft()
            if page_id in visited or depth > self.max_depth:
                continue
            visited.add(page_id)

            page = self._fetch_page(page_id, auth)
            title = page.get("title", f"page_{page_id}")
            html = page.get("body", {}).get("storage", {}).get("value", "")
            text = BeautifulSoup(html, "html.parser").get_text("\n", strip=True)
            all_content.append(f"# Page: {title}\n{text}")

            attachment_text = self._read_attachments(page_id, work_path, auth)
            if attachment_text:
                all_content.append(f"## Attachments for {title}\n{attachment_text}")

            for child_id in self._fetch_child_page_ids(page_id, auth):
                queue.append((child_id, depth + 1))

        return "\n\n".join(all_content)

    def _extract_page_id(self, url_or_page_id: str) -> str:
        if url_or_page_id.isdigit():
            return url_or_page_id

        by_id = re.search(r"pageId=(\d+)", url_or_page_id)
        if by_id:
            return by_id.group(1)

        by_path = re.search(r"/(\d+)(?:/|$)", url_or_page_id)
        if by_path:
            return by_path.group(1)

        raise ValueError("Unable to extract Confluence page ID from input")

    def _resolve_auth(self, username: str | None, password: str | None) -> tuple[str, str]:
        if username and password:
            return username, password
        return self.auth

    def _fetch_page(self, page_id: str, auth: tuple[str, str]) -> dict:
        url = f"{self.base_url}{self.api_path}/{page_id}"
        params = {"expand": "body.storage,version"}
        response = requests.get(
            url,
            params=params,
            auth=auth,
            timeout=60,
            verify=self.verify_tls,
        )
        response.raise_for_status()
        return response.json()

    def _fetch_child_page_ids(self, page_id: str, auth: tuple[str, str]) -> list[str]:
        url = f"{self.base_url}{self.api_path}/{page_id}{self.child_page_suffix}"
        response = requests.get(url, auth=auth, timeout=45, verify=self.verify_tls)
        if response.status_code >= 400:
            return []
        payload = response.json()
        return [item.get("id") for item in payload.get("results", []) if item.get("id")]

    def _read_attachments(self, page_id: str, working_dir: Path, auth: tuple[str, str]) -> str:
        url = f"{self.base_url}{self.api_path}/{page_id}{self.attachment_suffix}"
        response = requests.get(url, auth=auth, timeout=45, verify=self.verify_tls)
        if response.status_code >= 400:
            return ""

        output: list[str] = []
        for item in response.json().get("results", []):
            title = item.get("title", "")
            ext = Path(title).suffix.lower().replace(".", "")
            if ext not in self.document_reader.SUPPORTED_TYPES:
                continue

            dl = item.get("_links", {}).get("download")
            if not dl:
                continue

            file_url = f"{self.base_url}{dl}"
            target_path = working_dir / title
            file_response = requests.get(
                file_url,
                auth=auth,
                timeout=90,
                verify=self.verify_tls,
            )
            if file_response.status_code >= 400:
                continue

            target_path.write_bytes(file_response.content)
            artifact = self.document_reader.read(str(target_path))
            output.append(f"### Attachment: {title}\n{artifact.raw_text}")

        return "\n\n".join(output)
