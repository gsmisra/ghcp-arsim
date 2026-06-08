import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def configure_logging(log_file: str = "output/platform.log") -> None:
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    if root_logger.handlers:
        return

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    )

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    rotating_handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=5)
    rotating_handler.setFormatter(formatter)

    root_logger.addHandler(stream_handler)
    root_logger.addHandler(rotating_handler)
