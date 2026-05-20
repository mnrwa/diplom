"""
Neural news summarizer + risk scorer.

Models used (auto-downloaded on first call, cached in ~/.cache/huggingface/):
  - cointegrated/rut5-base-absum  (~240 MB) — Russian T5 fine-tuned on news summarization
  - cointegrated/rubert-tiny2     (~15 MB)  — Tiny Russian BERT for risk semantic scoring

Both run on CPU; ~1-2 s per item for T5, <0.1 s for BERT.
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── lazy singletons ───────────────────────────────────────────────────────────

_lock = threading.Lock()
_t5_tokenizer = None
_t5_model = None
_bert_tokenizer = None
_bert_model = None
_risk_embeddings: Optional[list] = None

T5_MODEL = "cointegrated/rut5-base-absum"
BERT_MODEL = "cointegrated/rubert-tiny2"

# Canonical risk concepts — pre-encoded at load time into BERT embeddings
RISK_CONCEPTS = [
    "авария ДТП столкновение погибли пострадавшие",
    "перекрытие дороги трасса закрыта объезд",
    "серьёзное происшествие чрезвычайная ситуация",
    "гололёд туман снегопад опасные условия видимость",
    "пробка затор стоит несколько часов задержка",
    "ремонт дороги ограничение движения сужение полосы",
]


def _load_models():
    """Load both models once; thread-safe."""
    global _t5_tokenizer, _t5_model, _bert_tokenizer, _bert_model, _risk_embeddings

    with _lock:
        if _t5_model is not None:
            return True

        try:
            import torch
            from transformers import AutoModel, AutoTokenizer, T5ForConditionalGeneration, T5Tokenizer

            logger.info("Loading T5 summarizer: %s", T5_MODEL)
            _t5_tokenizer = T5Tokenizer.from_pretrained(T5_MODEL)
            _t5_model = T5ForConditionalGeneration.from_pretrained(T5_MODEL)
            _t5_model.eval()

            logger.info("Loading BERT risk encoder: %s", BERT_MODEL)
            _bert_tokenizer = AutoTokenizer.from_pretrained(BERT_MODEL)
            _bert_model = AutoModel.from_pretrained(BERT_MODEL)
            _bert_model.eval()

            # Pre-compute risk concept embeddings
            _risk_embeddings = [_encode(c) for c in RISK_CONCEPTS]

            logger.info("NLP models loaded successfully")
            return True

        except Exception as exc:
            logger.warning("NLP models unavailable (%s) — falling back to keyword mode", exc)
            return False


def _encode(text: str):
    """Return CLS-token embedding for text using rubert-tiny2."""
    import torch

    inputs = _bert_tokenizer(
        text, return_tensors="pt", truncation=True, max_length=128, padding=True
    )
    with torch.no_grad():
        out = _bert_model(**inputs)
    return out.last_hidden_state[:, 0, :].squeeze()  # (hidden,)


def _cosine(a, b) -> float:
    import torch

    return float(torch.cosine_similarity(a.unsqueeze(0), b.unsqueeze(0)).item())


# ── keyword fallback (used when models unavailable) ────────────────────────────

_RISK_KW = {
    "авария": 0.9, "дтп": 0.9, "погиб": 0.85, "пострадал": 0.8,
    "перекрыт": 0.85, "закрыт": 0.75, "гололёд": 0.7, "туман": 0.6,
    "снегопад": 0.6, "пробка": 0.55, "затор": 0.55, "ремонт": 0.4,
    "ограничени": 0.4, "опасн": 0.65, "стоит": 0.5, "задержк": 0.45,
}


def _keyword_risk(text: str) -> float:
    lower = text.lower()
    scores = [w for kw, w in _RISK_KW.items() if kw in lower]
    if not scores:
        return 0.1
    return min(1.0, max(scores) * 0.6 + sum(scores) / len(_RISK_KW) * 0.4)


def _clean(text: str) -> str:
    # Full URLs
    text = re.sub(r"https?://\S+", "", text)
    # Search-result URL snippets: "t.me › s › channel" / "site.com › path › page"
    text = re.sub(r"[\w.\-]+\.\w{2,6}\s*›[^\n.!?]*", "", text)
    # Search engine attribution: "Brave Search / Новосибирск", "Google News / ..."
    text = re.sub(r"(Brave Search|Google News|Bing|DuckDuckGo)\s*/[^\n]*", "", text, flags=re.IGNORECASE)
    # Source trailers in RSS titles: " – Telegram", " — ТАСС"
    text = re.sub(
        r"\s[–—\-]\s+(Telegram|ВКонтакте|VK|RIA|РИА|Интерфакс|ТАСС|Коммерсантъ|РБК|Ведомости|RT|Россия\s*24|Lenta\.ru)\s*$",
        "", text, flags=re.IGNORECASE,
    )
    # @mentions and #hashtags
    text = re.sub(r"@\w+|#\w+", "", text)
    # Collapse whitespace
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _is_garbage(text: str) -> bool:
    """True if text is too short or still looks like a raw search snippet."""
    if not text or len(text.split()) < 4:
        return True
    if re.search(r"[\w.\-]+\.\w{2,6}\s*›", text):
        return True
    return False


# ── public API ─────────────────────────────────────────────────────────────────

@dataclass
class NewsAnalysis:
    id: str
    reformulated: str        # readable reformulated text (neural or extractive)
    risk_score: float        # 0.0 – 1.0
    risk_level: str          # low / medium / high
    model_used: str          # "rut5+rubert" or "keywords"
    keywords_found: List[str]


def analyze_news_item(item_id: str, title: str, summary: str) -> NewsAnalysis:
    """
    Reformulate news and return risk coefficient.
    Uses neural models if available, falls back to keyword scoring.
    """
    title = _clean(title or "")
    summary = _clean(summary or "")

    # If summary is garbage (search snippet), ignore it — use only the title
    if _is_garbage(summary) or summary == title:
        full_text = title
    else:
        full_text = f"{title}. {summary}" if summary else title

    keywords_found = [kw for kw in _RISK_KW if kw in full_text.lower()]

    # ── try neural path ───────────────────────────────────────────────────────
    if _load_models():
        try:
            reformulated = _neural_summarize(full_text)
            risk_score = _neural_risk(reformulated)
            return NewsAnalysis(
                id=item_id,
                reformulated=reformulated,
                risk_score=round(risk_score, 3),
                risk_level=_level(risk_score),
                model_used="rut5+rubert",
                keywords_found=keywords_found,
            )
        except Exception as exc:
            logger.warning("Neural inference failed for item %s: %s", item_id, exc)

    # ── fallback: extractive + keyword risk ───────────────────────────────────
    reformulated = _extractive_fallback(title, summary)
    risk_score = _keyword_risk(full_text)
    return NewsAnalysis(
        id=item_id,
        reformulated=reformulated,
        risk_score=round(risk_score, 3),
        risk_level=_level(risk_score),
        model_used="keywords",
        keywords_found=keywords_found,
    )


def _neural_summarize(text: str) -> str:
    """Generate abstractive summary with rut5-base-absum."""
    inputs = _t5_tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=False,
    )
    out = _t5_model.generate(
        **inputs,
        max_new_tokens=80,
        min_new_tokens=15,
        num_beams=4,
        length_penalty=1.0,
        repetition_penalty=1.3,
        early_stopping=True,
    )
    decoded = _t5_tokenizer.decode(out[0], skip_special_tokens=True)
    # Capitalize and trim
    decoded = decoded.strip()
    if decoded:
        decoded = decoded[0].upper() + decoded[1:]
    return decoded or text[:200]


def _neural_risk(text: str) -> float:
    """
    Compute risk coefficient via cosine similarity to pre-encoded risk concepts.
    Returns max similarity across all concepts, scaled to [0, 1].
    """
    emb = _encode(text)
    sims = [_cosine(emb, ref) for ref in _risk_embeddings]
    # BERT cosine similarities in [0.3, 1.0] range typically; normalise to [0, 1]
    raw = max(sims)
    # Shift: similarity > 0.7 → high risk, ~0.4 → low risk
    normalised = max(0.0, min(1.0, (raw - 0.35) / 0.45))

    # Blend with keyword signal for stability
    kw_score = _keyword_risk(text)
    return normalised * 0.7 + kw_score * 0.3


def _level(score: float) -> str:
    if score >= 0.6:
        return "high"
    if score >= 0.35:
        return "medium"
    return "low"


def _extractive_fallback(title: str, summary: str) -> str:
    """Best-sentence extraction when neural models unavailable."""
    combined = f"{title}. {summary}" if summary else title
    sentences = re.split(r"(?<=[.!?])\s+", combined)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 15]
    if not sentences:
        return title[:200]

    def score(s: str) -> float:
        lower = s.lower()
        return sum(w for kw, w in _RISK_KW.items() if kw in lower)

    best = max(sentences, key=score)
    return best
