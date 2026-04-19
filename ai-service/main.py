from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import risk, weather, news, eta
from services.news_pipeline import create_news_collector, get_news_collector, set_news_collector

app = FastAPI(
    title="Logistics AI Service",
    description="Модуль анализа рисков и оптимизации маршрутов",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(risk.router)
app.include_router(weather.router)
app.include_router(news.router)
app.include_router(eta.router)


@app.on_event("startup")
async def startup_news_collector():
    collector = set_news_collector(create_news_collector())
    await collector.start()


@app.on_event("shutdown")
async def shutdown_news_collector():
    await get_news_collector().stop()

@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-service"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
