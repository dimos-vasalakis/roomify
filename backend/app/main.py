from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

app = FastAPI(title="Roomify")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().frontend_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
