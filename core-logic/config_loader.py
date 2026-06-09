from __future__ import annotations

import os
from pathlib import Path


DEFAULTS = {
    "APP_CONFIG_FILE": "app_config.properties",
    "APP_HOST": "0.0.0.0",
    "APP_PORT": "5050",
    "APP_BASE_URL": "http://localhost:5050",
    "APP_UI_PATH": "/",
    "APP_HEALTH_PATH": "/health",
    "APP_ROUTE_OUTPUT_CONTENT": "/api/output/content",
    "APP_ROUTE_OUTPUT_DOWNLOAD": "/api/output/download",
    "APP_OUTPUT_DIR": "output",
    "APP_LOG_FILE": "output/platform.log",
    "APP_TEMP_UPLOAD_DIR": "temp_uploads",
    "APP_OUTPUT_RETENTION_KEEP_LOGS": "true",
    "JIRA_BASE_URL": "https://your-jira-instance.atlassian.net",
    "JIRA_API_PATH": "/rest/api/3/issue",
    "JIRA_COMMENT_API_SUFFIX": "/comment",
    "JIRA_EMAIL": "",
    "JIRA_API_TOKEN": "",
    "CONFLUENCE_BASE_URL": "https://your-confluence-instance.atlassian.net/wiki",
    "CONFLUENCE_API_PATH": "/rest/api/content",
    "CONFLUENCE_CHILD_PAGE_SUFFIX": "/child/page",
    "CONFLUENCE_ATTACHMENT_SUFFIX": "/child/attachment",
    "CONFLUENCE_EMAIL": "",
    "CONFLUENCE_API_TOKEN": "",
    "DEFAULT_OUTPUT_FORMAT": "bdd",
    "DEFAULT_GENERATION_MODE": "ghcp_bridge_strict",
    "MAX_CONFLUENCE_DEPTH": "5",
    "JIRA_MAX_ATTACHMENT_BYTES": "10485760",
    "GHCP_BRIDGE_COMMAND": "",
    "GHCP_BRIDGE_TIMEOUT_SECONDS": "180",
    "GHCP_BRIDGE_MAX_CASES": "5",
    "BDD_FEATURE_ROLE_LINE": "As a QE engineer in banking delivery",
    "BDD_FEATURE_GOAL_LINE": "I want robust and traceable automated test scenarios",
    "BDD_FEATURE_VALUE_LINE": "So that business critical workflows remain reliable and compliant",
    "JIRA_CSV_ISSUE_TYPE": "Test",
    "JIRA_CSV_PRIORITY": "High",
    "VERIFY_TLS": "true",
}


class Config:
    def __init__(self, path: str = "app_config.properties") -> None:
        self.path = Path(path)
        self.values = DEFAULTS.copy()
        self._load_file()
        self._overlay_environment()

    def _load_file(self) -> None:
        if not self.path.exists():
            return
        for raw_line in self.path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            self.values[key.strip()] = value.strip()

    def _overlay_environment(self) -> None:
        for key in self.values:
            env_value = os.getenv(key)
            if env_value is not None and env_value != "":
                self.values[key] = env_value

    def get(self, key: str, default: str | None = None) -> str:
        if default is None:
            return self.values.get(key, "")
        return self.values.get(key, default)

    def get_bool(self, key: str, default: bool = True) -> bool:
        value = self.values.get(key)
        if value is None:
            return default
        return value.lower() in ("1", "true", "yes", "y")

    def get_int(self, key: str, default: int = 0) -> int:
        try:
            return int(self.values.get(key, str(default)))
        except ValueError:
            return default
