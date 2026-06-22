from __future__ import annotations

import logging
import os
import signal
import threading

import requests

logger = logging.getLogger(__name__)


class ShutdownManager:
    def __init__(self, bridge_base_url: str, auth_token: str = "") -> None:
        self._bridge_base_url = bridge_base_url.rstrip("/")
        self._auth_token = auth_token

    def shutdown_all(self) -> dict:
        results: dict[str, str] = {}

        results["bridge"] = self._stop_bridge()

        self._schedule_exit()
        results["server"] = "shutdown scheduled"

        return results

    def _stop_bridge(self) -> str:
        headers: dict[str, str] = {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"

        try:
            response = requests.post(
                f"{self._bridge_base_url}/v1/close-window",
                headers=headers,
                json={},
                timeout=5,
            )
            if response.ok:
                return "closed"
            return f"bridge returned {response.status_code}"
        except requests.RequestException as error:
            logger.warning("Could not close bridge window: %s", error)
            return f"unreachable: {error}"

    def _schedule_exit(self) -> None:
        def _exit():
            logger.info("Shutting down ARSIM platform...")
            os.kill(os.getpid(), signal.SIGTERM)

        timer = threading.Timer(1.0, _exit)
        timer.daemon = True
        timer.start()
