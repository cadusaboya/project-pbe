from django.urls import path

from .views import ItemAssetsView, MatchLobbyView, StatsView, UnitStatsView, VersionsView, WinningCompsView

urlpatterns = [
    path("stats/", StatsView.as_view(), name="stats"),
    path("unit-stats/", UnitStatsView.as_view(), name="unit-stats"),
    path("winning-comps/", WinningCompsView.as_view(), name="winning-comps"),
    path("versions/", VersionsView.as_view(), name="versions"),
    path("item-assets/", ItemAssetsView.as_view(), name="item-assets"),
    path("match/<str:match_id>/lobby", MatchLobbyView.as_view(), name="match-lobby"),
]
