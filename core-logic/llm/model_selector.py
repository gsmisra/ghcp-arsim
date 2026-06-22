from __future__ import annotations

import threading
from typing import Any

import requests


class ModelSelector:
    def __init__(self, bridge_base_url: str, auth_token: str = "") -> None:
        self._bridge_base_url = bridge_base_url.rstrip("/")
        self._auth_token = auth_token
        self._selected_model_id: str = ""
        self._lock = threading.Lock()

    @property
    def selected_model_id(self) -> str:
        with self._lock:
            return self._selected_model_id

    def select(self, model_id: str) -> None:
        with self._lock:
            self._selected_model_id = model_id

    def fetch_available_models(self, timeout: int = 15) -> list[dict[str, Any]]:
        headers: dict[str, str] = {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"

        response = requests.get(
            f"{self._bridge_base_url}/v1/models",
            headers=headers,
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("models", [])

    def inject_model_id(self, payload: dict[str, Any]) -> dict[str, Any]:
        model_id = self.selected_model_id
        if model_id:
            payload["model_id"] = model_id
        return payload
