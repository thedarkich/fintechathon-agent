"""Importing this package registers every action in app.agent.core.REGISTRY."""

from app.agent.actions import (  # noqa: F401
    analysis,
    cards,
    control,
    payments,
    places,
    queries,
    recommend,
    security,
    subscriptions,
    wealth,
)
from app.agent.core import REGISTRY

__all__ = ["REGISTRY"]
