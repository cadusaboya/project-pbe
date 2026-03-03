from django.urls import path

from .views import ChampionsView, CompsView, DataVersionView, ExploreMatchesView, ExploreView, HiddenCompsView, ItemAssetsView, ItemStatsView, MatchLobbyView, PlayerListView, PlayerProfileView, PlayerStatsView, SearchCompsView, StatsView, TraitDataView, UnitStarStatsView, UnitStatsView, VersionsView, WinningCompsView

urlpatterns = [
    path("data-version/", DataVersionView.as_view(), name="data-version"),
    path("stats/", StatsView.as_view(), name="stats"),
    path("unit-stats/", UnitStatsView.as_view(), name="unit-stats"),
    path("unit-stats/<str:unit_name>/star-stats/", UnitStarStatsView.as_view(), name="unit-star-stats"),
    path("item-stats/", ItemStatsView.as_view(), name="item-stats"),
    path("explore/", ExploreView.as_view(), name="explore"),
    path("explore/matches/", ExploreMatchesView.as_view(), name="explore-matches"),
    path("comps/", CompsView.as_view(), name="comps"),
    path("comps/hidden/", HiddenCompsView.as_view(), name="comps-hidden"),
    path("winning-comps/", WinningCompsView.as_view(), name="winning-comps"),
    path("versions/", VersionsView.as_view(), name="versions"),
    path("traits/", TraitDataView.as_view(), name="traits"),
    path("item-assets/", ItemAssetsView.as_view(), name="item-assets"),
    path("match/<str:match_id>/lobby", MatchLobbyView.as_view(), name="match-lobby"),
    path("search-comps/", SearchCompsView.as_view(), name="search-comps"),
    path("player/<str:player_name>/profile/", PlayerProfileView.as_view(), name="player-profile"),
    path("players/", PlayerListView.as_view(), name="player-list"),
    path("player-stats/", PlayerStatsView.as_view(), name="player-stats"),
    path("champions/", ChampionsView.as_view(), name="champions"),
]
