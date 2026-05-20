"""
Neural news analysis endpoint.
POST /ai/news-analyze — reformulate text + return risk coefficient.
Falls back to keyword mode when models are unavailable.
"""
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel

from services.nlp_summarizer import analyze_news_item

router = APIRouter(tags=["nlp"])


class NewsItem(BaseModel):
    id: str
    title: str
    summary: str = ""


class NlpAnalysisResult(BaseModel):
    id: str
    reformulated: str
    risk_score: float
    risk_level: str          # low / medium / high
    model_used: str          # "rut5+rubert" or "keywords"
    keywords_found: List[str]


@router.post("/ai/news-analyze", response_model=List[NlpAnalysisResult])
def news_analyze(items: List[NewsItem]):
    """
    Analyze news items using neural models (T5 + BERT) or keyword fallback.
    Returns reformulated readable text and risk coefficient for each item.
    """
    results = []
    for item in items:
        analysis = analyze_news_item(item.id, item.title, item.summary)
        results.append(NlpAnalysisResult(
            id=analysis.id,
            reformulated=analysis.reformulated,
            risk_score=analysis.risk_score,
            risk_level=analysis.risk_level,
            model_used=analysis.model_used,
            keywords_found=analysis.keywords_found,
        ))
    return results
