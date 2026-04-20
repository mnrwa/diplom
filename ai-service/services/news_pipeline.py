from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import math
import os
import re
import sqlite3
import threading
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha1
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, unquote, urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
SOURCES_FILE = Path(
    os.getenv("NEWS_SOURCES_FILE", str(DATA_DIR / "news_sources.json"))
)
NEWS_CACHE_DB_PATH = Path(
    os.getenv("NEWS_CACHE_DB_PATH", str(DATA_DIR / "news_cache.sqlite3"))
)

DEFAULT_LOOKBACK_HOURS = int(os.getenv("NEWS_LOOKBACK_HOURS", "72"))
DEFAULT_MAX_ITEMS = int(os.getenv("NEWS_MAX_ITEMS", "12"))
DEFAULT_POLL_SECONDS = int(os.getenv("NEWS_COLLECTOR_POLL_SECONDS", "300"))
DEFAULT_RETENTION_DAYS = int(os.getenv("NEWS_RETENTION_DAYS", "14"))
DEFAULT_FRESH_SECONDS = int(os.getenv("NEWS_COLLECTOR_FRESH_SECONDS", "900"))
DEFAULT_HTTP_TIMEOUT = float(os.getenv("NEWS_HTTP_TIMEOUT_SECONDS", "20"))
DEFAULT_ROUTE_DISCOVERY_FRESH_SECONDS = int(
    os.getenv("NEWS_ROUTE_DISCOVERY_FRESH_SECONDS", "900")
)
DEFAULT_ROUTE_LOCALITIES_LIMIT = int(
    os.getenv("NEWS_ROUTE_LOCALITIES_LIMIT", "8")
)
DEFAULT_ROUTE_GEOCODE_POINTS = int(
    os.getenv("NEWS_ROUTE_GEOCODE_POINTS", "4")
)
HTTP_USER_AGENT = os.getenv(
    "NEWS_HTTP_USER_AGENT",
    "logistics-ai-news-collector/2.0 (+public-source-ingestion)",
)

RISK_KEYWORDS: dict[str, float] = {
    "авария": 0.72,
    "дтп": 0.72,
    "столкновение": 0.74,
    "смертельное дтп": 0.9,
    "перекрытие": 0.82,
    "закрыта дорога": 0.82,
    "ремонт дороги": 0.48,
    "дорожные работы": 0.42,
    "пробка": 0.44,
    "затор": 0.44,
    "гололед": 0.62,
    "гололёд": 0.62,
    "снегопад": 0.63,
    "туман": 0.45,
    "метель": 0.66,
    "шторм": 0.7,
    "ливень": 0.54,
    "пожар": 0.58,
    "наводнение": 0.9,
    "мост перекрыт": 0.8,
    "объезд": 0.38,
    "accident": 0.72,
    "collision": 0.74,
    "road closure": 0.82,
    "traffic jam": 0.44,
    "road work": 0.42,
    "flood": 0.9,
    "storm": 0.7,
    "ice": 0.52,
}

ROUTE_STOPWORDS = {
    "улица",
    "ул",
    "проспект",
    "пр",
    "дом",
    "д",
    "корпус",
    "шоссе",
    "трасса",
    "склад",
    "пвз",
    "центр",
    "маршрут",
    "дорога",
    "область",
    "район",
    "route",
    "road",
}

DISCOVERY_CONTEXT_TERMS = {
    "дтп",
    "авар",
    "столк",
    "трасс",
    "дорог",
    "ремонт",
    "пробк",
    "затор",
    "перекрыт",
    "объезд",
    "мост",
    "трафик",
    "транспорт",
    "погод",
    "ливен",
    "снег",
    "метел",
    "туман",
    "гололед",
    "ice",
    "road",
    "traffic",
    "closure",
    "accident",
    "storm",
}

# Override legacy mojibake constants with clean UTF-8 values.
RISK_KEYWORDS = {
    "авария": 0.72,
    "дтп": 0.72,
    "столкновение": 0.74,
    "смертельное дтп": 0.9,
    "перекрытие": 0.82,
    "ограничение движения": 0.58,
    "ограничено движение": 0.58,
    "закрыта дорога": 0.82,
    "ремонт дороги": 0.48,
    "дорожные работы": 0.42,
    "ремонт": 0.28,
    "трасса": 0.24,
    "пробка": 0.44,
    "затор": 0.44,
    "гололед": 0.62,
    "гололёд": 0.62,
    "снегопад": 0.63,
    "туман": 0.45,
    "метель": 0.66,
    "шторм": 0.7,
    "ливень": 0.54,
    "пожар": 0.58,
    "наводнение": 0.9,
    "мост перекрыт": 0.8,
    "объезд": 0.38,
    "accident": 0.72,
    "collision": 0.74,
    "road closure": 0.82,
    "traffic jam": 0.44,
    "road work": 0.42,
    "flood": 0.9,
    "storm": 0.7,
    "ice": 0.52,
}

ROUTE_STOPWORDS = {
    "улица",
    "ул",
    "проспект",
    "пр",
    "дом",
    "д",
    "корпус",
    "шоссе",
    "трасса",
    "склад",
    "пвз",
    "центр",
    "маршрут",
    "дорога",
    "область",
    "район",
    "route",
    "road",
}

DISCOVERY_CONTEXT_TERMS = {
    "дтп",
    "авар",
    "столк",
    "трасс",
    "дорог",
    "ремонт",
    "пробк",
    "затор",
    "перекрыт",
    "объезд",
    "мост",
    "трафик",
    "транспорт",
    "погод",
    "ливен",
    "снег",
    "метел",
    "туман",
    "гололед",
    "ice",
    "road",
    "traffic",
    "closure",
    "accident",
    "storm",
}

_news_collector: "NewsCollector | None" = None
_reverse_geocode_cache: dict[str, dict[str, Any]] = {}


@dataclass
class RoutePoint:
    name: str | None = None
    city: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None


@dataclass
class ParsedNewsItem:
    source: str
    channel: str
    title: str
    summary: str
    published_at: datetime
    url: str | None = None
    city: str | None = None
    lat: float | None = None
    lon: float | None = None
    source_id: str | None = None

    @property
    def normalized_text(self) -> str:
        return normalize_text(
            " ".join(
                filter(
                    None,
                    [self.title, self.summary, self.city, self.channel, self.source],
                )
            )
        )

    @property
    def dedupe_key(self) -> str:
        return build_dedupe_key(self)


@dataclass
class RouteContext:
    points: list[RoutePoint]
    coordinates: list[tuple[float, float]]
    terms: list[str]

    @property
    def has_context(self) -> bool:
        return bool(self.coordinates or self.terms)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def parse_datetime(value: Any) -> datetime:
    if value is None:
        return utc_now()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)

    text = str(value).strip()
    if not text:
        return utc_now()

    with contextlib.suppress(ValueError):
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    with contextlib.suppress(Exception):
        parsed = parsedate_to_datetime(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return utc_now()


def parse_optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    raw_value = str(value).strip()
    # If the entire value is a bare URL, return empty — URLs are not readable content
    if re.match(r"^[a-z][a-z0-9+.-]*://\S*$", raw_value, flags=re.IGNORECASE):
        return ""
    text = BeautifulSoup(raw_value, "html.parser").get_text(" ", strip=True)
    # Strip inline URLs from mixed text
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_text(value: str | None) -> str:
    text = clean_text(value).lower()
    text = text.replace("ё", "е")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def unique_terms(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw_value in values:
        value = str(raw_value or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def build_dedupe_key(item: ParsedNewsItem) -> str:
    base = "|".join(
        [
            normalize_text(item.source),
            normalize_text(item.channel),
            normalize_text(item.url or ""),
            normalize_text(item.title),
            normalize_text(item.summary)[:240],
            item.published_at.date().isoformat(),
        ]
    )
    return sha1(base.encode("utf-8")).hexdigest()


def deduplicate_items(items: list[ParsedNewsItem]) -> list[ParsedNewsItem]:
    unique: dict[str, ParsedNewsItem] = {}
    for item in items:
        existing = unique.get(item.dedupe_key)
        if existing is None or item.published_at > existing.published_at:
            unique[item.dedupe_key] = item
    return list(unique.values())


def serialize_item(item: ParsedNewsItem) -> dict[str, Any]:
    return {
        "source": item.source,
        "channel": item.channel,
        "title": item.title,
        "summary": item.summary,
        "publishedAt": item.published_at.isoformat(),
        "url": item.url,
        "city": item.city,
        "lat": item.lat,
        "lon": item.lon,
        "source_id": item.source_id,
    }


def coerce_route_point(value: dict[str, Any] | RoutePoint | None) -> RoutePoint | None:
    if value is None:
        return None
    if isinstance(value, RoutePoint):
        return value
    return RoutePoint(
        name=value.get("name"),
        city=value.get("city"),
        address=value.get("address"),
        lat=parse_optional_float(value.get("lat")),
        lon=parse_optional_float(value.get("lon")),
    )


def extract_route_terms(*values: str | None) -> list[str]:
    terms: list[str] = []
    for value in values:
        normalized = normalize_text(value)
        if not normalized:
            continue
        for token in re.findall(r"[\w-]+", normalized):
            if len(token) < 3 or token.isdigit() or token in ROUTE_STOPWORDS:
                continue
            terms.append(token)
    return unique_terms(terms)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


class NewsStorage:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.db_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self):
        with self._lock, self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS news_items (
                    dedupe_key TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    normalized_text TEXT NOT NULL,
                    published_at TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    url TEXT,
                    city TEXT,
                    lat REAL,
                    lon REAL,
                    raw_payload TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_news_items_published_at
                    ON news_items(published_at DESC);
                CREATE INDEX IF NOT EXISTS idx_news_items_source_id
                    ON news_items(source_id);

                CREATE TABLE IF NOT EXISTS source_status (
                    source_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    platform TEXT,
                    enabled INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    last_started_at TEXT,
                    last_finished_at TEXT,
                    last_success_at TEXT,
                    last_error TEXT,
                    last_item_count INTEGER NOT NULL DEFAULT 0,
                    last_new_count INTEGER NOT NULL DEFAULT 0,
                    last_updated_count INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            connection.commit()

    def upsert_items(
        self,
        source_config: dict[str, Any],
        items: list[ParsedNewsItem],
    ) -> dict[str, int]:
        inserted = 0
        updated = 0
        fetched_at = utc_now().isoformat()
        unique_items = deduplicate_items(items)

        with self._lock, self._connect() as connection:
            for item in unique_items:
                row = connection.execute(
                    "SELECT dedupe_key FROM news_items WHERE dedupe_key = ?",
                    (item.dedupe_key,),
                ).fetchone()

                connection.execute(
                    """
                    INSERT INTO news_items (
                        dedupe_key,
                        source_id,
                        source,
                        channel,
                        title,
                        summary,
                        normalized_text,
                        published_at,
                        fetched_at,
                        url,
                        city,
                        lat,
                        lon,
                        raw_payload
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(dedupe_key) DO UPDATE SET
                        source_id = excluded.source_id,
                        source = excluded.source,
                        channel = excluded.channel,
                        title = excluded.title,
                        summary = excluded.summary,
                        normalized_text = excluded.normalized_text,
                        published_at = excluded.published_at,
                        fetched_at = excluded.fetched_at,
                        url = excluded.url,
                        city = excluded.city,
                        lat = excluded.lat,
                        lon = excluded.lon,
                        raw_payload = excluded.raw_payload
                    """,
                    (
                        item.dedupe_key,
                        item.source_id
                        or str(source_config.get("id") or source_config.get("name") or "source"),
                        item.source,
                        item.channel,
                        item.title,
                        item.summary,
                        item.normalized_text,
                        item.published_at.isoformat(),
                        fetched_at,
                        item.url,
                        item.city,
                        item.lat,
                        item.lon,
                        json.dumps(serialize_item(item), ensure_ascii=False),
                    ),
                )

                if row is None:
                    inserted += 1
                else:
                    updated += 1

            connection.commit()

        return {
            "inserted": inserted,
            "updated": updated,
            "stored": len(unique_items),
        }

    def save_source_status(
        self,
        source_config: dict[str, Any],
        *,
        status: str,
        started_at: datetime,
        finished_at: datetime,
        item_count: int = 0,
        new_count: int = 0,
        updated_count: int = 0,
        error: str | None = None,
    ) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO source_status (
                    source_id,
                    name,
                    kind,
                    platform,
                    enabled,
                    status,
                    last_started_at,
                    last_finished_at,
                    last_success_at,
                    last_error,
                    last_item_count,
                    last_new_count,
                    last_updated_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    name = excluded.name,
                    kind = excluded.kind,
                    platform = excluded.platform,
                    enabled = excluded.enabled,
                    status = excluded.status,
                    last_started_at = excluded.last_started_at,
                    last_finished_at = excluded.last_finished_at,
                    last_success_at = CASE
                        WHEN excluded.status = 'ok' THEN excluded.last_finished_at
                        ELSE source_status.last_success_at
                    END,
                    last_error = excluded.last_error,
                    last_item_count = excluded.last_item_count,
                    last_new_count = excluded.last_new_count,
                    last_updated_count = excluded.last_updated_count
                """,
                (
                    str(source_config.get("id") or source_config.get("name") or "source"),
                    str(source_config.get("name") or source_config.get("id") or "Source"),
                    str(source_config.get("kind") or "unknown"),
                    source_config.get("platform"),
                    1 if source_config.get("enabled", True) else 0,
                    status,
                    started_at.isoformat(),
                    finished_at.isoformat(),
                    finished_at.isoformat() if status == "ok" else None,
                    error,
                    item_count,
                    new_count,
                    updated_count,
                ),
            )
            connection.commit()

    def get_recent_items(
        self,
        *,
        lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
        limit: int = 250,
        source_id: str | None = None,
    ) -> list[ParsedNewsItem]:
        cutoff = utc_now() - timedelta(hours=max(1, lookback_hours))
        sql = """
            SELECT *
            FROM news_items
            WHERE published_at >= ?
        """
        params: list[Any] = [cutoff.isoformat()]

        if source_id:
            sql += " AND source_id = ?"
            params.append(source_id)

        sql += " ORDER BY published_at DESC LIMIT ?"
        params.append(limit)

        with self._lock, self._connect() as connection:
            rows = connection.execute(sql, tuple(params)).fetchall()

        return [self._row_to_item(row) for row in rows]

    def list_feed(
        self,
        *,
        limit: int = 50,
        lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    ) -> list[dict[str, Any]]:
        items = self.get_recent_items(lookback_hours=lookback_hours, limit=limit)
        return [serialize_item(item) for item in items]

    def cleanup_old_items(self, retention_days: int = DEFAULT_RETENTION_DAYS) -> int:
        cutoff = utc_now() - timedelta(days=max(1, retention_days))
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM news_items WHERE published_at < ?",
                (cutoff.isoformat(),),
            )
            connection.commit()
            return cursor.rowcount or 0

    def get_last_fetched_at(self, source_id: str) -> datetime | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT last_success_at FROM source_status WHERE source_id = ?",
                (source_id,),
            ).fetchone()

        if not row or not row["last_success_at"]:
            return None
        return parse_datetime(row["last_success_at"])

    def get_storage_status(self) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            total_items = (
                connection.execute("SELECT COUNT(*) AS count FROM news_items").fetchone()[
                    "count"
                ]
                or 0
            )
            latest_item = connection.execute(
                "SELECT published_at FROM news_items ORDER BY published_at DESC LIMIT 1"
            ).fetchone()
            source_rows = connection.execute(
                "SELECT * FROM source_status ORDER BY source_id"
            ).fetchall()

        return {
            "db_path": str(self.db_path),
            "total_items": total_items,
            "latest_item_at": latest_item["published_at"] if latest_item else None,
            "sources": [dict(row) for row in source_rows],
        }

    def _row_to_item(self, row: sqlite3.Row) -> ParsedNewsItem:
        return ParsedNewsItem(
            source=row["source"],
            channel=row["channel"],
            title=row["title"],
            summary=row["summary"],
            published_at=parse_datetime(row["published_at"]),
            url=row["url"],
            city=row["city"],
            lat=row["lat"],
            lon=row["lon"],
            source_id=row["source_id"],
        )


class NewsCollector:
    def __init__(
        self,
        *,
        storage: NewsStorage | None = None,
        sources_file: Path = SOURCES_FILE,
        poll_seconds: int = DEFAULT_POLL_SECONDS,
        fresh_seconds: int = DEFAULT_FRESH_SECONDS,
        retention_days: int = DEFAULT_RETENTION_DAYS,
        route_discovery_fresh_seconds: int = DEFAULT_ROUTE_DISCOVERY_FRESH_SECONDS,
        route_localities_limit: int = DEFAULT_ROUTE_LOCALITIES_LIMIT,
        route_geocode_points: int = DEFAULT_ROUTE_GEOCODE_POINTS,
    ):
        self.storage = storage or NewsStorage(NEWS_CACHE_DB_PATH)
        self.sources_file = Path(sources_file)
        self.poll_seconds = max(30, int(poll_seconds))
        self.fresh_seconds = max(30, int(fresh_seconds))
        self.retention_days = max(1, int(retention_days))
        self.route_discovery_fresh_seconds = max(120, int(route_discovery_fresh_seconds))
        self.route_localities_limit = max(3, int(route_localities_limit))
        self.route_geocode_points = max(1, int(route_geocode_points))
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None
        self._refresh_lock = asyncio.Lock()
        self._running = False
        self.started_at: datetime | None = None
        self.last_refresh_started_at: datetime | None = None
        self.last_refresh_finished_at: datetime | None = None
        self.last_refresh_summary: dict[str, Any] | None = None
        self.last_error: str | None = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return

        self._running = True
        self.started_at = utc_now()
        await self._ensure_client()
        self._task = asyncio.create_task(
            self._collection_loop(),
            name="news-collector-loop",
        )

    async def stop(self) -> None:
        self._running = False

        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        if self._client:
            await self._client.aclose()
            self._client = None

    async def refresh(
        self,
        *,
        force: bool = False,
        source_id: str | None = None,
    ) -> dict[str, Any]:
        async with self._refresh_lock:
            await self._ensure_client()
            sources = [
                config
                for config in load_source_configs(self.sources_file)
                if config.get("enabled", True)
            ]

            if source_id:
                sources = [
                    config
                    for config in sources
                    if str(config.get("id") or config.get("name")) == source_id
                ]

            started_at = utc_now()
            self.last_refresh_started_at = started_at
            summary = {
                "started_at": started_at.isoformat(),
                "finished_at": None,
                "force": force,
                "sources_total": len(sources),
                "sources_processed": 0,
                "sources_skipped": 0,
                "sources_failed": 0,
                "inserted": 0,
                "updated": 0,
                "stored": 0,
                "cleanup_deleted": 0,
            }

            for source_config in sources:
                source_started_at = utc_now()
                source_kind = str(source_config.get("kind") or "").lower().strip()
                source_key = str(
                    source_config.get("id") or source_config.get("name") or "source"
                )
                source_fresh_seconds = max(
                    30,
                    int(source_config.get("fresh_seconds") or self.fresh_seconds),
                )

                if source_kind in {
                    "route_search_rss",
                    "route_regional_search",
                    "route_search_web",
                }:
                    self.storage.save_source_status(
                        source_config,
                        status="skipped",
                        started_at=source_started_at,
                        finished_at=utc_now(),
                        error="context-required",
                    )
                    summary["sources_skipped"] += 1
                    continue

                if not force:
                    last_fetched_at = self.storage.get_last_fetched_at(source_key)
                    if last_fetched_at and (
                        utc_now() - last_fetched_at
                    ).total_seconds() < source_fresh_seconds:
                        self.storage.save_source_status(
                            source_config,
                            status="skipped",
                            started_at=source_started_at,
                            finished_at=utc_now(),
                            error=f"fresh-cache:{source_fresh_seconds}s",
                        )
                        summary["sources_skipped"] += 1
                        continue

                try:
                    items = await self._collect_source(source_config)
                    counts = self.storage.upsert_items(source_config, items)
                    self.storage.save_source_status(
                        source_config,
                        status="ok",
                        started_at=source_started_at,
                        finished_at=utc_now(),
                        item_count=counts["stored"],
                        new_count=counts["inserted"],
                        updated_count=counts["updated"],
                    )
                    summary["sources_processed"] += 1
                    summary["inserted"] += counts["inserted"]
                    summary["updated"] += counts["updated"]
                    summary["stored"] += counts["stored"]
                except Exception as exc:  # noqa: BLE001
                    self.storage.save_source_status(
                        source_config,
                        status="error",
                        started_at=source_started_at,
                        finished_at=utc_now(),
                        error=str(exc),
                    )
                    summary["sources_failed"] += 1
                    self.last_error = str(exc)

            summary["cleanup_deleted"] = self.storage.cleanup_old_items(
                self.retention_days
            )
            summary["finished_at"] = utc_now().isoformat()
            self.last_refresh_finished_at = parse_datetime(summary["finished_at"])
            self.last_refresh_summary = summary
            return summary

    def get_status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "poll_seconds": self.poll_seconds,
            "fresh_seconds": self.fresh_seconds,
            "retention_days": self.retention_days,
            "route_discovery_fresh_seconds": self.route_discovery_fresh_seconds,
            "route_localities_limit": self.route_localities_limit,
            "route_geocode_points": self.route_geocode_points,
            "sources_file": str(self.sources_file),
            "last_refresh_started_at": (
                self.last_refresh_started_at.isoformat()
                if self.last_refresh_started_at
                else None
            ),
            "last_refresh_finished_at": (
                self.last_refresh_finished_at.isoformat()
                if self.last_refresh_finished_at
                else None
            ),
            "last_refresh_summary": self.last_refresh_summary,
            "last_error": self.last_error,
            "storage": self.storage.get_storage_status(),
        }

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                follow_redirects=True,
                timeout=DEFAULT_HTTP_TIMEOUT,
                headers={"User-Agent": HTTP_USER_AGENT},
            )
        return self._client

    async def _collection_loop(self) -> None:
        while self._running:
            try:
                await self.refresh(force=False)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)

            await asyncio.sleep(self.poll_seconds)

    async def _collect_source(self, source_config: dict[str, Any]) -> list[ParsedNewsItem]:
        kind = str(source_config.get("kind") or "").lower().strip()
        client = await self._ensure_client()

        if kind == "local_export":
            return await collect_local_export(source_config)
        if kind == "rss":
            return await collect_rss(source_config, client)
        if kind == "html":
            return await collect_html(source_config, client)
        if kind == "browser_html":
            return await collect_browser_html(source_config)

        raise ValueError(f"Unsupported source kind: {kind}")


async def collect_local_export(source_config: dict[str, Any]) -> list[ParsedNewsItem]:
    source_path = resolve_source_path(source_config.get("path"))
    if not source_path.exists():
        raise FileNotFoundError(f"Local export not found: {source_path}")

    payload = json.loads(source_path.read_text(encoding="utf-8"))
    raw_items = payload if isinstance(payload, list) else payload.get("items", [])
    platform = str(payload.get("platform") or source_config.get("platform") or "LOCAL")
    channel = str(
        payload.get("channel")
        or source_config.get("channel")
        or source_config.get("name")
        or "Local Export"
    )

    items: list[ParsedNewsItem] = []
    source_id = str(source_config.get("id") or source_config.get("name") or "local")
    max_items = int(source_config.get("max_items") or DEFAULT_MAX_ITEMS * 2)

    for raw_item in raw_items[:max_items]:
        items.append(
            ParsedNewsItem(
                source=platform,
                channel=channel,
                title=str(raw_item.get("title") or "Событие по маршруту"),
                summary=str(raw_item.get("text") or raw_item.get("summary") or ""),
                published_at=parse_datetime(raw_item.get("published_at")),
                url=raw_item.get("url"),
                city=raw_item.get("city"),
                lat=parse_optional_float(raw_item.get("lat")),
                lon=parse_optional_float(raw_item.get("lon")),
                source_id=source_id,
            )
        )

    return items


async def collect_rss(
    source_config: dict[str, Any],
    client: httpx.AsyncClient,
) -> list[ParsedNewsItem]:
    url = build_source_url(source_config)
    response = await client.get(url)
    response.raise_for_status()
    return parse_rss_document(source_config, response.content, url)


async def collect_html(
    source_config: dict[str, Any],
    client: httpx.AsyncClient,
) -> list[ParsedNewsItem]:
    url = build_source_url(source_config)
    response = await client.get(url)
    response.raise_for_status()
    return parse_html_document(source_config, response.text, url)


async def collect_browser_html(source_config: dict[str, Any]) -> list[ParsedNewsItem]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "browser_html requires playwright. Install it and run "
            "'python -m playwright install chromium'."
        ) from exc

    url = build_source_url(source_config)
    scroll_steps = max(1, int(source_config.get("scroll_steps") or 4))
    scroll_pause_ms = max(250, int(source_config.get("scroll_pause_ms") or 900))
    viewport_width = int(source_config.get("viewport_width") or 1440)
    viewport_height = int(source_config.get("viewport_height") or 1200)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            locale=str(source_config.get("locale") or "ru-RU"),
            viewport={"width": viewport_width, "height": viewport_height},
            user_agent=HTTP_USER_AGENT,
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            with contextlib.suppress(Exception):
                await page.wait_for_load_state("networkidle", timeout=15_000)

            for _ in range(scroll_steps):
                await page.evaluate(
                    "window.scrollBy(0, Math.max(window.innerHeight, document.body.scrollHeight * 0.7));"
                )
                await page.wait_for_timeout(scroll_pause_ms)

            html = await page.content()
        finally:
            await context.close()
            await browser.close()

    return parse_html_document(source_config, html, url)


def parse_html_document(
    source_config: dict[str, Any],
    html: str,
    base_url: str,
) -> list[ParsedNewsItem]:
    soup = BeautifulSoup(html, "html.parser")
    item_selector = str(source_config.get("item_selector") or "article")
    title_selector = source_config.get("title_selector")
    summary_selector = source_config.get("summary_selector")
    link_selector = source_config.get("link_selector")
    date_selector = source_config.get("date_selector")
    date_attr = source_config.get("date_attr")
    city_selector = source_config.get("city_selector")
    lat_attr = source_config.get("lat_attr")
    lon_attr = source_config.get("lon_attr")

    nodes = soup.select(item_selector) or soup.find_all("article")
    items: list[ParsedNewsItem] = []
    source_id = str(source_config.get("id") or source_config.get("name") or "html")
    platform = str(source_config.get("platform") or "WEBSITE")
    channel = str(source_config.get("channel") or source_config.get("name") or base_url)
    max_items = int(source_config.get("max_items") or DEFAULT_MAX_ITEMS * 2)

    for node in nodes[:max_items]:
        title = extract_node_text(node, title_selector) or extract_node_text(
            node, "h1, h2, h3"
        )
        if not title:
            continue

        summary = extract_node_text(node, summary_selector) or truncate_text(
            clean_text(node.get_text(" ", strip=True)),
            600,
        )
        raw_link = extract_node_link(node, link_selector)
        raw_date = extract_node_value(node, date_selector, date_attr)
        city = extract_node_text(node, city_selector) or source_config.get("city")
        lat = parse_optional_float(node.get(lat_attr)) if lat_attr else None
        lon = parse_optional_float(node.get(lon_attr)) if lon_attr else None

        items.append(
            ParsedNewsItem(
                source=platform,
                channel=channel,
                title=clean_text(title),
                summary=truncate_text(clean_text(summary), 600),
                published_at=parse_datetime(raw_date),
                url=urljoin(base_url, raw_link) if raw_link else base_url,
                city=clean_text(city) if city else None,
                lat=lat,
                lon=lon,
                source_id=source_id,
            )
        )

    return items


def parse_rss_document(
    source_config: dict[str, Any],
    xml_content: bytes | str,
    feed_url: str,
    *,
    locality_name: str | None = None,
    locality_lat: float | None = None,
    locality_lon: float | None = None,
) -> list[ParsedNewsItem]:
    root = ET.fromstring(xml_content)

    items: list[ParsedNewsItem] = []
    nodes = find_xml_nodes(root, {"item", "entry"})
    source_id = str(source_config.get("id") or source_config.get("name") or "rss")
    platform = str(source_config.get("platform") or "WEBSITE")
    channel = str(source_config.get("channel") or source_config.get("name") or feed_url)
    max_items = int(source_config.get("max_items") or DEFAULT_MAX_ITEMS * 2)

    for node in nodes[:max_items]:
        source_name, source_url = first_xml_source(node)
        title = first_xml_text(node, ["title"]) or "Новость по маршруту"
        summary = first_xml_text(
            node,
            ["description", "summary", "content", "encoded"],
        ) or ""
        published_at = parse_datetime(
            first_xml_text(
                node,
                ["pubDate", "published", "updated", "created", "dc:date"],
            )
        )
        link = first_xml_link(node) or source_url or feed_url
        lat, lon = first_xml_geo(node)

        items.append(
            ParsedNewsItem(
                source=source_name or platform,
                channel=channel,
                title=clean_text(title),
                summary=truncate_text(clean_text(summary), 600),
                published_at=published_at,
                url=link,
                city=locality_name or source_config.get("city"),
                lat=lat if lat is not None else locality_lat,
                lon=lon if lon is not None else locality_lon,
                source_id=source_id,
            )
        )

    return items


def load_source_configs(path: Path = SOURCES_FILE) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("news_sources.json must contain a list")
    return [dict(item) for item in payload]


def build_source_url(source_config: dict[str, Any]) -> str:
    url = str(source_config.get("url") or "").strip()
    if not url:
        raise ValueError("Source URL is missing")

    query_params = source_config.get("query_params")
    if not query_params:
        return url

    parsed = urlparse(url)
    combined_query = urlencode(query_params, doseq=True)
    return urlunparse(parsed._replace(query=combined_query))


def resolve_source_path(raw_path: str | os.PathLike[str] | None) -> Path:
    if raw_path is None:
        raise ValueError("Source path is missing")

    path = Path(raw_path)
    if path.is_absolute():
        return path
    return (BASE_DIR / path).resolve()


def extract_node_text(node: Any, selector: Any) -> str | None:
    if not selector:
        return None
    match = node.select_one(str(selector))
    if not match:
        return None
    return clean_text(match.get_text(" ", strip=True))


def extract_node_link(node: Any, selector: Any) -> str | None:
    match = node.select_one(str(selector)) if selector else node.find("a")
    if not match:
        return None
    return match.get("href")


def extract_node_value(node: Any, selector: Any, attr: Any) -> str | None:
    if not selector:
        return None
    match = node.select_one(str(selector))
    if not match:
        return None
    if attr:
        return match.get(str(attr))
    return clean_text(match.get_text(" ", strip=True))


def local_tag(tag: str) -> str:
    return tag.split("}", 1)[-1].split(":", 1)[-1]


def find_xml_nodes(root: ET.Element, names: set[str]) -> list[ET.Element]:
    nodes: list[ET.Element] = []
    for node in root.iter():
        if local_tag(node.tag) in names:
            nodes.append(node)
    return nodes


def first_xml_text(node: ET.Element, names: list[str]) -> str | None:
    normalized = {name.lower() for name in names}
    for child in node.iter():
        if local_tag(child.tag).lower() in normalized and child.text:
            return clean_text(child.text)
    return None


def first_xml_link(node: ET.Element) -> str | None:
    for child in node.iter():
        if local_tag(child.tag).lower() != "link":
            continue
        href = child.attrib.get("href")
        if href:
            return href
        if child.text and child.text.strip():
            return child.text.strip()
    return None


def first_xml_geo(node: ET.Element) -> tuple[float | None, float | None]:
    lat = None
    lon = None
    point_text = None

    for child in node.iter():
        tag = local_tag(child.tag).lower()
        if tag in {"lat", "geo:lat"} and child.text:
            lat = parse_optional_float(child.text)
        elif tag in {"lon", "long", "geo:lon", "geo:long"} and child.text:
            lon = parse_optional_float(child.text)
        elif tag in {"point", "georss:point"} and child.text:
            point_text = child.text

    if point_text and (lat is None or lon is None):
        parts = re.split(r"\s+", point_text.strip())
        if len(parts) >= 2:
            lat = lat if lat is not None else parse_optional_float(parts[0])
            lon = lon if lon is not None else parse_optional_float(parts[1])

    return lat, lon


def first_xml_source(node: ET.Element) -> tuple[str | None, str | None]:
    for child in node.iter():
        if local_tag(child.tag).lower() != "source":
            continue

        text = clean_text(child.text or "")
        source_url = child.attrib.get("url")
        return (text or None), source_url

    return None, None


async def discover_route_news(
    collector: NewsCollector,
    context: RouteContext,
    *,
    lookback_hours: int,
    force_refresh: bool = False,
) -> dict[str, Any]:
    route_sources = [
        config
        for config in load_source_configs(collector.sources_file)
        if config.get("enabled", True)
        and str(config.get("kind") or "").lower().strip()
        in {"route_search_rss", "route_regional_search", "route_search_web"}
    ]

    if not route_sources or not context.has_context:
        return {
            "enabled": bool(route_sources),
            "localities": [],
            "sources_processed": 0,
            "sources_skipped": 0,
            "sources_failed": 0,
            "stored": 0,
        }

    client = await collector._ensure_client()
    localities = await resolve_route_localities(collector, context, client)

    summary = {
        "enabled": True,
        "localities": localities,
        "sources_processed": 0,
        "sources_skipped": 0,
        "sources_failed": 0,
        "stored": 0,
    }

    for source_config in route_sources:
        fresh_seconds = max(
            120,
            int(
                source_config.get("fresh_seconds")
                or collector.route_discovery_fresh_seconds
            ),
        )

        for locality in localities:
            synthetic_source = build_route_source_config(source_config, locality)
            source_id = str(synthetic_source["id"])
            started_at = utc_now()

            if not force_refresh:
                last_fetched_at = collector.storage.get_last_fetched_at(source_id)
                if last_fetched_at and (
                    utc_now() - last_fetched_at
                ).total_seconds() < fresh_seconds:
                    collector.storage.save_source_status(
                        synthetic_source,
                        status="skipped",
                        started_at=started_at,
                        finished_at=utc_now(),
                        error=f"fresh-cache:{fresh_seconds}s",
                    )
                    summary["sources_skipped"] += 1
                    continue

            try:
                items = await collect_route_search_rss(
                    source_config,
                    locality=locality,
                    lookback_hours=lookback_hours,
                    client=client,
                )
                counts = collector.storage.upsert_items(synthetic_source, items)
                collector.storage.save_source_status(
                    synthetic_source,
                    status="ok",
                    started_at=started_at,
                    finished_at=utc_now(),
                    item_count=counts["stored"],
                    new_count=counts["inserted"],
                    updated_count=counts["updated"],
                )
                summary["sources_processed"] += 1
                summary["stored"] += counts["stored"]
            except Exception as exc:  # noqa: BLE001
                collector.storage.save_source_status(
                    synthetic_source,
                    status="error",
                    started_at=started_at,
                    finished_at=utc_now(),
                    error=str(exc),
                )
                summary["sources_failed"] += 1
                collector.last_error = str(exc)

    return summary


async def resolve_route_localities(
    collector: NewsCollector,
    context: RouteContext,
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    localities: list[dict[str, Any]] = []

    for point in context.points:
        locality = locality_from_route_point(point)
        if locality:
            localities.append(locality)

    corridor_points = select_route_corridor_points(
        context.coordinates,
        limit=collector.route_geocode_points,
    )
    for route_lat, route_lon in corridor_points:
        locality = await reverse_geocode_locality(client, route_lat, route_lon)
        if locality:
            localities.append(locality)

    unique_localities: list[dict[str, Any]] = []
    seen: set[str] = set()
    for locality in localities:
        locality_key = build_locality_dedupe_key(locality.get("name"))
        if (
            not locality_key
            or locality_key in seen
            or not is_discoverable_locality_name(locality.get("name"))
            or locality_is_duplicate_by_distance(locality, unique_localities)
        ):
            continue
        seen.add(locality_key)
        unique_localities.append(locality)

    return unique_localities[: collector.route_localities_limit]


def build_locality_dedupe_key(value: str | None) -> str:
    normalized = normalize_text(normalize_locality_label(value))
    if not normalized:
        return ""

    normalized = re.sub(
        r"(ское|ская|ский|ские|ское поселение|ский район|ская область)$",
        "",
        normalized,
    ).strip(" -")
    return normalized


def locality_is_duplicate_by_distance(
    locality: dict[str, Any],
    existing_localities: list[dict[str, Any]],
) -> bool:
    lat = parse_optional_float(locality.get("lat"))
    lon = parse_optional_float(locality.get("lon"))
    if lat is None or lon is None:
        return False

    for existing in existing_localities:
        existing_lat = parse_optional_float(existing.get("lat"))
        existing_lon = parse_optional_float(existing.get("lon"))
        if existing_lat is None or existing_lon is None:
            continue
        if haversine_km(lat, lon, existing_lat, existing_lon) <= 3:
            return True

    return False


def locality_from_route_point(point: RoutePoint) -> dict[str, Any] | None:
    candidates = [
        normalize_locality_label(point.city),
        point.name if not is_generic_route_name(point.name) else None,
        point.address,
    ]
    name = next((clean_text(value) for value in candidates if clean_text(value)), None)
    if not is_discoverable_locality_name(name):
        return None

    return {
        "name": name,
        "region": None,
        "lat": point.lat,
        "lon": point.lon,
    }


def is_generic_route_name(value: str | None) -> bool:
    normalized = normalize_text(value)
    return (
        normalized.startswith("промежуточная точка")
        or "промежуточ" in normalized and "точк" in normalized
        or normalized.startswith("waypoint")
        or normalized in {"route-midpoint", "midpoint"}
    )


def is_discoverable_locality_name(value: str | None) -> bool:
    cleaned = clean_text(value)
    if not cleaned:
        return False
    if "?" in cleaned:
        return False
    if is_generic_route_name(cleaned):
        return False

    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", cleaned)
    return len(letters) >= 3


def is_generic_route_name(value: str | None) -> bool:
    normalized = normalize_text(value)
    return (
        normalized.startswith("промежуточная точка")
        or ("промежуточ" in normalized and "точк" in normalized)
        or normalized.startswith("waypoint")
        or normalized in {"route-midpoint", "midpoint"}
    )


def is_discoverable_locality_name(value: str | None) -> bool:
    cleaned = clean_text(value)
    if not cleaned:
        return False
    if "?" in cleaned:
        return False
    if is_generic_route_name(cleaned):
        return False

    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", cleaned)
    return len(letters) >= 3


def select_route_corridor_points(
    coordinates: list[tuple[float, float]],
    *,
    limit: int,
) -> list[tuple[float, float]]:
    if not coordinates or limit <= 0:
        return []

    internal = coordinates[1:-1] if len(coordinates) > 2 else coordinates
    if len(internal) <= limit:
        return list(internal)

    selected: list[tuple[float, float]] = []
    for index in range(limit):
        position = round((index + 1) * (len(internal) + 1) / (limit + 1)) - 1
        position = max(0, min(len(internal) - 1, position))
        selected.append(internal[position])
    return selected


async def reverse_geocode_locality(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
) -> dict[str, Any] | None:
    cache_key = f"{lat:.3f}:{lon:.3f}"
    if cache_key in _reverse_geocode_cache:
        return dict(_reverse_geocode_cache[cache_key])

    response = await client.get(
        "https://nominatim.openstreetmap.org/reverse",
        params={
            "format": "jsonv2",
            "lat": lat,
            "lon": lon,
            "zoom": 10,
            "addressdetails": 1,
            "accept-language": "ru",
        },
        headers={"User-Agent": HTTP_USER_AGENT},
    )
    response.raise_for_status()
    payload = response.json()
    address = payload.get("address") or {}

    locality_name = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("hamlet")
        or address.get("municipality")
        or address.get("county")
    )
    if not locality_name:
        return None

    locality = {
        "name": normalize_locality_label(clean_text(locality_name)),
        "region": clean_text(
            address.get("state")
            or address.get("region")
            or address.get("state_district")
            or ""
        )
        or None,
        "lat": lat,
        "lon": lon,
    }
    _reverse_geocode_cache[cache_key] = locality
    return dict(locality)


def build_route_source_config(
    source_config: dict[str, Any],
    locality: dict[str, Any],
) -> dict[str, Any]:
    locality_key = sha1(normalize_text(locality.get("name")).encode("utf-8")).hexdigest()[
        :12
    ]
    source_id = f"{source_config.get('id', 'route-discovery')}:{locality_key}"
    return {
        "id": source_id,
        "enabled": True,
        "kind": "route_search_rss",
        "name": f"{source_config.get('name', 'Route Discovery')} / {locality.get('name')}",
        "platform": source_config.get("platform", "REGIONAL_WEB"),
        "channel": f"{source_config.get('provider', 'google-news')} / {locality.get('name')}",
        "city": locality.get("name"),
    }


async def collect_route_search_rss(
    source_config: dict[str, Any],
    *,
    locality: dict[str, Any],
    lookback_hours: int,
    client: httpx.AsyncClient,
) -> list[ParsedNewsItem]:
    all_items: list[ParsedNewsItem] = []
    max_items_per_query = int(source_config.get("max_items_per_query") or 8)

    for query in build_route_search_queries(source_config, locality, lookback_hours):
        search_url = build_google_news_rss_search_url(query)
        response = await client.get(search_url)
        response.raise_for_status()

        query_config = {
            "id": build_route_source_config(source_config, locality)["id"],
            "platform": source_config.get("platform", "REGIONAL_WEB"),
            "channel": "internet-discovery",
            "max_items": max_items_per_query,
        }
        all_items.extend(
            parse_rss_document(
                query_config,
                response.content,
                search_url,
            )
        )

    return deduplicate_items(filter_route_items_for_locality(all_items, locality))


def build_route_search_queries(
    source_config: dict[str, Any],
    locality: dict[str, Any],
    lookback_hours: int,
) -> list[str]:
    location = normalize_locality_label(str(locality.get("name") or "").strip())
    region = str(locality.get("region") or "").strip()
    if not location:
        return []

    templates = source_config.get("query_templates") or [
        '"{location}" (дтп OR пробка OR перекрытие OR ремонт дороги OR трасса)',
        '"{location}" новости дороги',
        '"{location}" происшествия транспорт',
    ]
    when_days = max(1, min(14, math.ceil(lookback_hours / 24)))

    return unique_terms(
        template.format(
            location=location,
            region=region,
            when_days=when_days,
        )
        + f" when:{when_days}d"
        for template in templates
    )


def build_google_news_rss_search_url(query: str) -> str:
    return (
        "https://news.google.com/rss/search?"
        + urlencode({"q": query, "hl": "ru", "gl": "RU", "ceid": "RU:ru"})
    )


def normalize_locality_label(value: str | None) -> str | None:
    normalized = clean_text(value)
    if not normalized:
        return None

    normalized = re.sub(
        r"\b(городское|сельское|муниципальное)\s+поселение\b",
        "",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\b(муниципальный|городской|сельский)\s+(округ|район)\b",
        "",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\s+", " ", normalized).strip(" ,.-")
    return normalized or None


def filter_route_items_for_locality(
    items: list[ParsedNewsItem],
    locality: dict[str, Any],
) -> list[ParsedNewsItem]:
    terms = unique_terms(
        extract_route_terms(locality.get("name"), locality.get("region"))
    )
    if not terms:
        return items

    filtered: list[ParsedNewsItem] = []
    for item in items:
        text = item.normalized_text
        has_locality_match = any(term in text for term in terms)
        has_context_match = any(term in text for term in DISCOVERY_CONTEXT_TERMS)
        if has_locality_match and has_context_match:
            filtered.append(item)

    return filtered


ROUTE_SEARCH_PROVIDER_LABELS = {
    "google-news-rss": "Google News",
    "brave-html": "Brave Search",
    "duckduckgo-html": "DuckDuckGo",
    "bing-html": "Bing",
}

ROUTE_SEARCH_DEFAULT_PROVIDERS = [
    "google-news-rss",
    "brave-html",
]

ROUTE_SEARCH_PUBLIC_SITES = [
    "t.me/s",
    "vk.com",
    "max.ru",
]


def build_route_source_config(
    source_config: dict[str, Any],
    locality: dict[str, Any],
) -> dict[str, Any]:
    locality_key = sha1(normalize_text(locality.get("name")).encode("utf-8")).hexdigest()[
        :12
    ]
    source_id = f"{source_config.get('id', 'route-discovery')}:{locality_key}"
    provider_names = ", ".join(
        ROUTE_SEARCH_PROVIDER_LABELS.get(provider, provider)
        for provider in build_route_search_providers(source_config)
    )
    return {
        "id": source_id,
        "enabled": True,
        "kind": "route_search_web",
        "name": f"{source_config.get('name', 'Route Discovery')} / {locality.get('name')}",
        "platform": source_config.get("platform", "REGIONAL_WEB"),
        "channel": f"{provider_names} / {locality.get('name')}",
        "city": locality.get("name"),
    }


async def collect_route_search_rss(
    source_config: dict[str, Any],
    *,
    locality: dict[str, Any],
    lookback_hours: int,
    client: httpx.AsyncClient,
) -> list[ParsedNewsItem]:
    all_items: list[ParsedNewsItem] = []
    errors: list[str] = []
    max_items_per_query = int(source_config.get("max_items_per_query") or 8)
    providers = build_route_search_providers(source_config)

    for provider in providers:
        queries = build_route_search_queries(
            source_config,
            locality,
            lookback_hours,
            provider=provider,
        )
        for query in queries:
            try:
                items = await collect_route_search_provider_items(
                    provider,
                    query,
                    source_config=source_config,
                    locality=locality,
                    client=client,
                    max_items_per_query=max_items_per_query,
                )
                all_items.extend(items)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{provider}: {exc}")
                if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
                    if exc.response.status_code == 429:
                        break
            if provider == "brave-html":
                await asyncio.sleep(0.35)

    filtered_items = deduplicate_items(filter_route_items_for_locality(all_items, locality))
    if filtered_items:
        return filtered_items
    if errors:
        raise RuntimeError("; ".join(errors[:3]))
    return []


async def collect_route_search_provider_items(
    provider: str,
    query: str,
    *,
    source_config: dict[str, Any],
    locality: dict[str, Any],
    client: httpx.AsyncClient,
    max_items_per_query: int,
) -> list[ParsedNewsItem]:
    source_id = build_route_source_config(source_config, locality)["id"]
    query_config = {
        "id": source_id,
        "platform": source_config.get("platform", "REGIONAL_WEB"),
        "channel": f"{ROUTE_SEARCH_PROVIDER_LABELS.get(provider, provider)} / {locality.get('name')}",
        "max_items": max_items_per_query,
    }

    if provider == "google-news-rss":
        search_url = build_google_news_rss_search_url(query)
        response = await client.get(search_url)
        response.raise_for_status()
        return parse_rss_document(
            query_config,
            response.content,
            search_url,
            locality_name=clean_text(locality.get("name")),
            locality_lat=parse_optional_float(locality.get("lat")),
            locality_lon=parse_optional_float(locality.get("lon")),
        )

    if provider == "duckduckgo-html":
        search_url = build_duckduckgo_search_url(query)
        response = await client.get(search_url)
        response.raise_for_status()
        return parse_duckduckgo_search_results(
            response.text,
            query_config=query_config,
            search_url=search_url,
            locality=locality,
        )

    if provider == "brave-html":
        search_url = build_brave_search_url(query)
        response = await client.get(search_url)
        response.raise_for_status()
        return parse_brave_search_results(
            response.text,
            query_config=query_config,
            search_url=search_url,
            locality=locality,
        )

    if provider == "bing-html":
        search_url = build_bing_search_url(query)
        response = await client.get(search_url)
        response.raise_for_status()
        return parse_bing_search_results(
            response.text,
            query_config=query_config,
            search_url=search_url,
            locality=locality,
        )

    raise ValueError(f"Unsupported route search provider: {provider}")


def build_route_search_providers(source_config: dict[str, Any]) -> list[str]:
    configured = source_config.get("providers")
    if isinstance(configured, list):
        providers = [clean_text(value).lower() for value in configured if clean_text(value)]
    else:
        single = clean_text(source_config.get("provider"))
        providers = [single.lower()] if single else []

    return unique_terms(providers or ROUTE_SEARCH_DEFAULT_PROVIDERS)


def build_route_search_queries(
    source_config: dict[str, Any],
    locality: dict[str, Any],
    lookback_hours: int,
    *,
    provider: str | None = None,
) -> list[str]:
    del lookback_hours

    location = normalize_locality_label(str(locality.get("name") or "").strip())
    region = normalize_locality_label(str(locality.get("region") or "").strip())
    if not location:
        return []

    location_context = f'"{location}"'
    if region:
        location_context = f'{location_context} "{region}"'

    general_templates = source_config.get("query_templates") or [
        "{location_context} дорожные новости",
        "{location_context} дтп авария трасса",
        "{location_context} ремонт дороги перекрытие пробка",
        "{location_context} происшествия транспорт дорога",
    ]
    public_sites = source_config.get("public_sites") or ROUTE_SEARCH_PUBLIC_SITES
    social_templates = source_config.get("social_query_templates") or [
        'site:{site} {location_context} дтп авария перекрытие трасса ремонт пробка',
    ]

    if provider == "brave-html":
        general_templates = list(general_templates)[:2]
        public_sites = list(public_sites)[:2]

    queries = [
        template.format(
            location=location,
            region=region,
            location_context=location_context,
        ).strip()
        for template in general_templates
    ]

    if provider in {"brave-html", "duckduckgo-html", "bing-html"}:
        for site in public_sites:
            for template in social_templates:
                queries.append(
                    template.format(
                        site=site,
                        location=location,
                        region=region,
                        location_context=location_context,
                    ).strip()
                )

    return unique_terms(normalize_search_query(query) for query in queries)


def normalize_search_query(query: str) -> str:
    cleaned = clean_text(query)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.replace('""', "").replace("( )", "")
    return cleaned.strip()


def build_google_news_rss_search_url(query: str) -> str:
    return (
        "https://news.google.com/rss/search?"
        + urlencode({"q": query, "hl": "ru", "gl": "RU", "ceid": "RU:ru"})
    )


def build_duckduckgo_search_url(query: str) -> str:
    return "https://html.duckduckgo.com/html/?" + urlencode({"q": query, "kl": "ru-ru"})


def build_brave_search_url(query: str) -> str:
    return "https://search.brave.com/search?" + urlencode({"q": query, "source": "web"})


def build_bing_search_url(query: str) -> str:
    return "https://www.bing.com/search?" + urlencode({"q": query, "setlang": "ru-RU"})


def parse_duckduckgo_search_results(
    html: str,
    *,
    query_config: dict[str, Any],
    search_url: str,
    locality: dict[str, Any],
) -> list[ParsedNewsItem]:
    soup = BeautifulSoup(html, "html.parser")
    nodes = soup.select(".result")
    items: list[ParsedNewsItem] = []
    max_items = int(query_config.get("max_items") or DEFAULT_MAX_ITEMS)

    for node in nodes[: max_items * 2]:
        link_node = node.select_one(".result__title a, .result__a")
        title = clean_text(link_node.get_text(" ", strip=True) if link_node else "")
        raw_url = link_node.get("href") if link_node else ""
        snippet = extract_node_text(node, ".result__snippet") or ""
        url = unwrap_search_result_url(raw_url, search_url, provider="duckduckgo-html")
        item = build_search_result_item(
            provider="duckduckgo-html",
            query_config=query_config,
            locality=locality,
            title=title,
            summary=snippet,
            url=url,
        )
        if item:
            items.append(item)
        if len(items) >= max_items:
            break

    return items


def parse_bing_search_results(
    html: str,
    *,
    query_config: dict[str, Any],
    search_url: str,
    locality: dict[str, Any],
) -> list[ParsedNewsItem]:
    soup = BeautifulSoup(html, "html.parser")
    nodes = soup.select("li.b_algo")
    items: list[ParsedNewsItem] = []
    max_items = int(query_config.get("max_items") or DEFAULT_MAX_ITEMS)

    for node in nodes[: max_items * 2]:
        link_node = node.select_one("h2 a")
        title = clean_text(link_node.get_text(" ", strip=True) if link_node else "")
        raw_url = link_node.get("href") if link_node else ""
        snippet = extract_node_text(node, ".b_caption p") or extract_node_text(
            node, ".b_snippet"
        )
        url = unwrap_search_result_url(raw_url, search_url, provider="bing-html")
        item = build_search_result_item(
            provider="bing-html",
            query_config=query_config,
            locality=locality,
            title=title,
            summary=snippet or "",
            url=url,
        )
        if item:
            items.append(item)
        if len(items) >= max_items:
            break

    return items


def parse_brave_search_results(
    html: str,
    *,
    query_config: dict[str, Any],
    search_url: str,
    locality: dict[str, Any],
) -> list[ParsedNewsItem]:
    soup = BeautifulSoup(html, "html.parser")
    nodes = soup.select('[data-type="web"]')
    items: list[ParsedNewsItem] = []
    max_items = int(query_config.get("max_items") or DEFAULT_MAX_ITEMS)

    for node in nodes[: max_items * 2]:
        link_node = node.select_one("a[href]")
        title = clean_text(link_node.get_text(" ", strip=True) if link_node else "")
        raw_url = link_node.get("href") if link_node else ""
        snippet = (
            extract_node_text(node, ".snippet")
            or extract_node_text(node, "p")
            or ""
        )
        url = unwrap_search_result_url(raw_url, search_url, provider="brave-html")
        item = build_search_result_item(
            provider="brave-html",
            query_config=query_config,
            locality=locality,
            title=title,
            summary=snippet,
            url=url,
        )
        if item:
            items.append(item)
        if len(items) >= max_items:
            break

    return items


def build_search_result_item(
    *,
    provider: str,
    query_config: dict[str, Any],
    locality: dict[str, Any],
    title: str,
    summary: str,
    url: str | None,
) -> ParsedNewsItem | None:
    clean_title = clean_text(title)
    clean_summary = truncate_text(clean_text(summary or title), 600)
    if not clean_title or not url:
        return None

    return ParsedNewsItem(
        source=extract_result_domain(url)
        or ROUTE_SEARCH_PROVIDER_LABELS.get(provider, provider),
        channel=str(query_config.get("channel") or provider),
        title=clean_title,
        summary=clean_summary,
        published_at=parse_search_result_datetime(clean_summary),
        url=url,
        city=clean_text(locality.get("name")) or None,
        lat=parse_optional_float(locality.get("lat")),
        lon=parse_optional_float(locality.get("lon")),
        source_id=str(query_config.get("id") or provider),
    )


def unwrap_search_result_url(
    raw_url: str | None,
    base_url: str,
    *,
    provider: str,
) -> str | None:
    if not raw_url:
        return None

    absolute_url = urljoin(base_url, clean_text(raw_url))
    if provider == "duckduckgo-html":
        parsed = urlparse(absolute_url)
        if "duckduckgo.com" in parsed.netloc:
            candidate = parse_qs(parsed.query).get("uddg", [None])[0]
            if candidate:
                return unquote(candidate)
        return absolute_url

    if provider == "bing-html":
        parsed = urlparse(absolute_url)
        if "bing.com" not in parsed.netloc:
            return absolute_url
        tracking_value = parse_qs(parsed.query).get("u", [None])[0]
        if not tracking_value:
            return absolute_url
        decoded = decode_bing_result_url(tracking_value)
        return decoded or absolute_url

    if provider == "brave-html":
        return absolute_url

    return absolute_url


def decode_bing_result_url(value: str) -> str | None:
    candidate = unquote(value)
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate
    if candidate.startswith("a1"):
        payload = candidate[2:]
        padding = "=" * (-len(payload) % 4)
        with contextlib.suppress(Exception):
            decoded = base64.urlsafe_b64decode(payload + padding).decode(
                "utf-8",
                errors="ignore",
            )
            if decoded.startswith("http://") or decoded.startswith("https://"):
                return decoded
    return None


def parse_search_result_datetime(text: str | None) -> datetime:
    parsed_relative = parse_relative_search_datetime(text)
    if parsed_relative is not None:
        return parsed_relative

    parsed_absolute = parse_absolute_search_datetime(text)
    if parsed_absolute is not None:
        return parsed_absolute

    return utc_now()


def parse_relative_search_datetime(text: str | None) -> datetime | None:
    normalized = normalize_text(text)
    if not normalized:
        return None

    if "вчера" in normalized:
        return utc_now() - timedelta(days=1)

    patterns = [
        (r"(\d+)\s*(мин|минута|минуты|минут|minutes?|mins?)\s*(назад|ago)?", "minutes"),
        (r"(\d+)\s*(час|часа|часов|hours?|hrs?|hr|h)\s*(назад|ago)?", "hours"),
        (r"(\d+)\s*(день|дня|дней|days?)\s*(назад|ago)?", "days"),
        (r"(\d+)\s*(неделя|недели|недель|weeks?)\s*(назад|ago)?", "weeks"),
    ]

    for pattern, unit in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if not match:
            continue
        amount = int(match.group(1))
        return utc_now() - timedelta(**{unit: amount})

    return None


def parse_absolute_search_datetime(text: str | None) -> datetime | None:
    cleaned = clean_text(text)
    if not cleaned:
        return None

    numeric_match = re.search(
        r"(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?",
        cleaned,
    )
    if numeric_match:
        day = int(numeric_match.group(1))
        month = int(numeric_match.group(2))
        year = int(numeric_match.group(3))
        if year < 100:
            year += 2000
        hour = int(numeric_match.group(4) or 0)
        minute = int(numeric_match.group(5) or 0)
        with contextlib.suppress(ValueError):
            return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)

    month_names = {
        "янв": 1,
        "январ": 1,
        "фев": 2,
        "феврал": 2,
        "мар": 3,
        "март": 3,
        "апр": 4,
        "апрел": 4,
        "мая": 5,
        "май": 5,
        "июн": 6,
        "июнь": 6,
        "июл": 7,
        "июль": 7,
        "авг": 8,
        "август": 8,
        "сен": 9,
        "сентябр": 9,
        "окт": 10,
        "октябр": 10,
        "ноя": 11,
        "ноябр": 11,
        "дек": 12,
        "декабр": 12,
    }
    textual_match = re.search(
        r"(?<!\d)(\d{1,2})\s+([А-Яа-яA-Za-z.]+)\s+(\d{4})(?:\s*г\.?)?",
        cleaned,
    )
    if textual_match:
        day = int(textual_match.group(1))
        month_text = textual_match.group(2).strip(".").lower()
        year = int(textual_match.group(3))
        for prefix, month in month_names.items():
            if month_text.startswith(prefix):
                with contextlib.suppress(ValueError):
                    return datetime(year, month, day, tzinfo=timezone.utc)

    return None


def filter_route_items_for_locality(
    items: list[ParsedNewsItem],
    locality: dict[str, Any],
) -> list[ParsedNewsItem]:
    terms = unique_terms(
        extract_route_terms(locality.get("name"), locality.get("region"))
    )
    if not terms:
        return items

    filtered: list[ParsedNewsItem] = []
    for item in items:
        searchable_text = normalize_text(
            " ".join(
                filter(
                    None,
                    [item.title, item.summary, item.url, item.channel, item.source],
                )
            )
        )
        has_locality_match = any(
            keyword_matches_text(searchable_text, term) for term in terms
        )
        has_context_match = any(
            keyword_matches_text(searchable_text, term)
            for term in DISCOVERY_CONTEXT_TERMS
        )
        domain = extract_result_domain(item.url)
        is_public_social = domain in {"t.me", "vk.com", "m.vk.com", "max.ru"}
        if has_context_match and (has_locality_match or is_public_social):
            filtered.append(item)

    return filtered


def extract_result_domain(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    host = parsed.netloc.lower().strip()
    if host.startswith("www."):
        host = host[4:]
    return host or None


def build_route_context(
    *,
    lat: float | None = None,
    lon: float | None = None,
    start: dict[str, Any] | RoutePoint | None = None,
    end: dict[str, Any] | RoutePoint | None = None,
    waypoints: list[dict[str, Any] | RoutePoint] | None = None,
) -> RouteContext:
    points = [
        point
        for point in [
            coerce_route_point(start),
            *(coerce_route_point(item) for item in (waypoints or [])),
            coerce_route_point(end),
        ]
        if point
    ]

    if lat is not None and lon is not None:
        points.append(RoutePoint(name="route-midpoint", lat=lat, lon=lon))

    coordinates = [
        (point.lat, point.lon)
        for point in points
        if point.lat is not None and point.lon is not None
    ]

    terms = unique_terms(
        term
        for point in points
        for term in extract_route_terms(point.name, point.city, point.address)
    )

    return RouteContext(points=points, coordinates=coordinates, terms=terms)


def compute_keyword_score(text: str) -> tuple[float, list[str]]:
    hits: list[str] = []
    values: list[float] = []
    for keyword, weight in RISK_KEYWORDS.items():
        if keyword_matches_text(text, keyword):
            hits.append(keyword)
            values.append(weight)

    if not values:
        return 0.06, []

    max_value = max(values)
    density_boost = min(0.18, 0.04 * len(values))
    return clamp(max_value + density_boost), hits


def keyword_matches_text(text: str, keyword: str) -> bool:
    escaped_keyword = re.escape(keyword.strip())
    if not escaped_keyword:
        return False
    pattern = rf"(?<!\w){escaped_keyword}(?!\w)"
    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def compute_term_score(text: str, route_terms: list[str]) -> tuple[float, list[str]]:
    if not route_terms:
        return 0.0, []

    hits = [term for term in route_terms if keyword_matches_text(text, term)]
    if not hits:
        return 0.0, []

    return min(1.0, 0.25 + len(hits) * 0.18), hits[:10]


def compute_geo_score(
    item: ParsedNewsItem,
    context: RouteContext,
) -> tuple[float, float | None]:
    if item.lat is None or item.lon is None or not context.coordinates:
        return 0.0, None

    distance_km = min(
        haversine_km(item.lat, item.lon, route_lat, route_lon)
        for route_lat, route_lon in context.coordinates
    )

    if distance_km <= 10:
        return 1.0, distance_km
    if distance_km <= 25:
        return 0.9, distance_km
    if distance_km <= 60:
        return 0.65, distance_km
    if distance_km <= 120:
        return 0.38, distance_km
    if distance_km <= 220:
        return 0.18, distance_km
    return 0.05, distance_km


def compute_city_score(item: ParsedNewsItem, context: RouteContext) -> float:
    text = item.normalized_text
    route_cities = unique_terms(
        normalize_text(point.city or "")
        for point in context.points
        if point.city
    )
    if not route_cities:
        return 0.0

    hits = sum(1 for city in route_cities if city and keyword_matches_text(text, city))
    if not hits:
        return 0.0
    return clamp(0.25 + hits * 0.22)


def compute_freshness_score(published_at: datetime, lookback_hours: int) -> float:
    age_hours = max(0.0, (utc_now() - published_at).total_seconds() / 3600)
    horizon = max(12.0, float(lookback_hours))
    decay = max(0.0, 1 - age_hours / horizon)
    return clamp(0.1 + decay * 0.9)


def score_item_for_route(
    item: ParsedNewsItem,
    context: RouteContext,
    *,
    lookback_hours: int,
) -> dict[str, Any]:
    text = item.normalized_text
    keyword_score, keyword_hits = compute_keyword_score(text)
    term_score, term_hits = compute_term_score(text, context.terms)
    geo_score, distance_km = compute_geo_score(item, context)
    city_score = compute_city_score(item, context)
    freshness = compute_freshness_score(item.published_at, lookback_hours)

    if context.has_context:
        route_relevance = clamp(
            geo_score * 0.42 + term_score * 0.3 + city_score * 0.16 + freshness * 0.12
        )
    else:
        route_relevance = freshness

    score = clamp(keyword_score * 0.56 + route_relevance * 0.34 + freshness * 0.1)

    return {
        **serialize_item(item),
        "score": round(score, 3),
        "severity": round(score, 3),
        "route_relevance": round(route_relevance, 3),
        "keyword_risk": round(keyword_score, 3),
        "freshness": round(freshness, 3),
        "term_matches": term_hits,
        "keyword_hits": keyword_hits,
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
    }


def rank_news_items(
    items: list[ParsedNewsItem],
    context: RouteContext,
    *,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []

    for item in items:
        ranked_item = score_item_for_route(
            item,
            context,
            lookback_hours=lookback_hours,
        )
        if ranked_item["score"] >= 0.12 or ranked_item["route_relevance"] >= 0.25:
            ranked.append(ranked_item)

    ranked.sort(
        key=lambda row: (
            row["score"],
            row["route_relevance"],
            row["publishedAt"],
        ),
        reverse=True,
    )
    return ranked


def aggregate_total_risk(items: list[dict[str, Any]]) -> float:
    if not items:
        return 0.05

    weighted_score = 0.0
    weights = 0.0
    for index, item in enumerate(items[:6]):
        weight = max(0.3, 1 - index * 0.14)
        weighted_score += float(item["score"]) * weight
        weights += weight

    return round(clamp(weighted_score / max(weights, 1e-6)), 3)


def create_news_collector(**kwargs: Any) -> NewsCollector:
    return NewsCollector(**kwargs)


def set_news_collector(collector: NewsCollector) -> NewsCollector:
    global _news_collector
    _news_collector = collector
    return collector


def get_news_collector() -> NewsCollector:
    global _news_collector
    if _news_collector is None:
        _news_collector = create_news_collector()
    return _news_collector


async def refresh_news_collection(
    *,
    force: bool = False,
    source_id: str | None = None,
) -> dict[str, Any]:
    collector = get_news_collector()
    return await collector.refresh(force=force, source_id=source_id)


def get_news_collector_status() -> dict[str, Any]:
    return get_news_collector().get_status()


async def get_cached_news_feed(
    *,
    max_items: int = 25,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    lat: float | None = None,
    lon: float | None = None,
    start: dict[str, Any] | RoutePoint | None = None,
    end: dict[str, Any] | RoutePoint | None = None,
    waypoints: list[dict[str, Any] | RoutePoint] | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    collector = get_news_collector()
    stale_items_used = False

    if force_refresh or not collector.storage.get_recent_items(limit=1):
        await collector.refresh(force=True)

    context = build_route_context(
        lat=lat,
        lon=lon,
        start=start,
        end=end,
        waypoints=waypoints or [],
    )
    route_discovery = None
    if context.has_context:
        route_discovery = await discover_route_news(
            collector,
            context,
            lookback_hours=lookback_hours,
            force_refresh=force_refresh,
        )

    items = collector.storage.get_recent_items(
        lookback_hours=lookback_hours,
        limit=max(max_items * 6, 50),
    )
    if not items:
        items = collector.storage.get_recent_items(
            lookback_hours=24 * 365,
            limit=max(max_items * 6, 50),
        )
        stale_items_used = bool(items)

    ranked = rank_news_items(items, context, lookback_hours=lookback_hours)[:max_items]

    return {
        "items": ranked,
        "count": len(ranked),
        "stale_items_used": stale_items_used,
        "route_discovery": route_discovery,
        "collector": collector.get_status(),
    }


async def assess_route_news(
    *,
    lat: float | None = None,
    lon: float | None = None,
    start: dict[str, Any] | RoutePoint | None = None,
    end: dict[str, Any] | RoutePoint | None = None,
    waypoints: list[dict[str, Any] | RoutePoint] | None = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
) -> dict[str, Any]:
    collector = get_news_collector()
    stale_items_used = False
    context = build_route_context(
        lat=lat,
        lon=lon,
        start=start,
        end=end,
        waypoints=waypoints or [],
    )
    route_discovery = None

    if context.has_context:
        route_discovery = await discover_route_news(
            collector,
            context,
            lookback_hours=lookback_hours,
        )

    items = collector.storage.get_recent_items(
        lookback_hours=lookback_hours,
        limit=max(max_items * 8, 80),
    )
    if not items:
        await collector.refresh(force=True)
        items = collector.storage.get_recent_items(
            lookback_hours=lookback_hours,
            limit=max(max_items * 8, 80),
        )
    if not items:
        items = collector.storage.get_recent_items(
            lookback_hours=24 * 365,
            limit=max(max_items * 8, 80),
        )
        stale_items_used = bool(items)
    ranked = rank_news_items(items, context, lookback_hours=lookback_hours)
    risks = ranked[:max_items]

    return {
        "total_risk": aggregate_total_risk(risks),
        "count": len(risks),
        "lookback_hours": lookback_hours,
        "from_cache": True,
        "stale_items_used": stale_items_used,
        "route_discovery": route_discovery,
        "risks": risks,
    }
