"""
tracker.views package -- re-exports all view classes for backward compatibility.

urls.py imports from ``tracker.views`` which now resolves to this package __init__.
"""

from .cdragon import ChampionsView, MatchLobbyView, TraitDataView
from .comps import CompsView, HiddenCompsView, SearchCompsView, WinningCompsView
from .explore import ExploreMatchesView, ExploreView
from .items import ItemAssetsView, ItemStatsView
from .players import PlayerListView, PlayerProfileView, PlayerStatsView
from .stats import DataVersionView, StatsView, UnitStarStatsView, UnitStatsView, VersionsView

__all__ = [
    "DataVersionView",
    "StatsView",
    "VersionsView",
    "UnitStatsView",
    "UnitStarStatsView",
    "ItemAssetsView",
    "ItemStatsView",
    "ExploreView",
    "ExploreMatchesView",
    "CompsView",
    "HiddenCompsView",
    "SearchCompsView",
    "WinningCompsView",
    "PlayerProfileView",
    "PlayerListView",
    "PlayerStatsView",
    "TraitDataView",
    "ChampionsView",
    "MatchLobbyView",
]
