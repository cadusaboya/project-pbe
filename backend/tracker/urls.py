from django.urls import path

from .views import ExploreView, ItemAssetsView, ItemStatsView, MatchLobbyView, StatsView, UnitStarStatsView, UnitStatsView, VersionsView, WinningCompsView

urlpatterns = [
    path("stats/", StatsView.as_view(), name="stats"),
    path("unit-stats/", UnitStatsView.as_view(), name="unit-stats"),
    path("unit-stats/<str:unit_name>/star-stats/", UnitStarStatsView.as_view(), name="unit-star-stats"),
    path("item-stats/", ItemStatsView.as_view(), name="item-stats"),
    path("explore/", ExploreView.as_view(), name="explore"),
    path("winning-comps/", WinningCompsView.as_view(), name="winning-comps"),
    path("versions/", VersionsView.as_view(), name="versions"),
    path("item-assets/", ItemAssetsView.as_view(), name="item-assets"),
    path("match/<str:match_id>/lobby", MatchLobbyView.as_view(), name="match-lobby"),
]
