"""The knowledge graph page's data (SPEC 15, GET /api/graph)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ... import graph
from ..deps import current_user

router = APIRouter()


@router.get("/api/graph")
def knowledge_graph(user: dict = Depends(current_user)) -> dict:
    return graph.build(user)
