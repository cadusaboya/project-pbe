from django.contrib import admin

from .models import (
    AggregatedUnitStat,
    Comp,
    Match,
    Participant,
    Player,
    Unit,
    UnitUsage,
)


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ["game_name", "tag_line", "puuid", "last_seen_match_id", "last_polled_at"]
    search_fields = ["game_name", "tag_line", "puuid", "last_seen_match_id"]


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ["match_id", "game_datetime", "created_at"]
    ordering = ["-game_datetime"]
    search_fields = ["match_id"]


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ["match", "player", "puuid", "placement", "level", "gold_left"]
    list_filter = ["placement"]
    search_fields = ["puuid"]
    raw_id_fields = ["match", "player"]


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ["character_id"]
    search_fields = ["character_id"]


@admin.register(UnitUsage)
class UnitUsageAdmin(admin.ModelAdmin):
    list_display = ["unit", "participant", "star_level", "rarity"]
    list_select_related = ["unit", "participant"]
    raw_id_fields = ["participant"]


@admin.register(AggregatedUnitStat)
class AggregatedUnitStatAdmin(admin.ModelAdmin):
    list_display = ["unit", "games", "avg_placement", "top4_rate", "win_rate", "updated_at"]
    ordering = ["avg_placement"]
    search_fields = ["unit__character_id"]


@admin.register(Comp)
class CompAdmin(admin.ModelAdmin):
    list_display = ["name", "target_level", "is_active", "updated_at"]
    list_filter = ["is_active"]
    search_fields = ["name"]
