from rest_framework import serializers

from .models import AggregatedUnitStat, UnitUsage, Participant


class UnitStatSerializer(serializers.ModelSerializer):
    unit_name = serializers.CharField(source="unit.character_id", read_only=True)
    cost = serializers.IntegerField(source="unit.cost", read_only=True)
    traits = serializers.JSONField(source="unit.traits", read_only=True)

    class Meta:
        model = AggregatedUnitStat
        fields = ["unit_name", "cost", "traits", "games", "avg_placement", "top4_rate", "win_rate"]


class WinningUnitSerializer(serializers.ModelSerializer):
    character_id = serializers.CharField(source="unit.character_id", read_only=True)
    cost = serializers.IntegerField(source="unit.cost", read_only=True)
    traits = serializers.JSONField(source="unit.traits", read_only=True)

    class Meta:
        model = UnitUsage
        fields = ["character_id", "star_level", "cost", "traits", "items"]


class WinningCompSerializer(serializers.ModelSerializer):
    match_id = serializers.CharField(source="match.match_id", read_only=True)
    game_datetime = serializers.DateTimeField(source="match.game_datetime", read_only=True)
    game_version = serializers.CharField(source="match.game_version", read_only=True)
    winner = serializers.SerializerMethodField()
    units = WinningUnitSerializer(source="unit_usages", many=True, read_only=True)

    placement = serializers.IntegerField(read_only=True)

    class Meta:
        model = Participant
        fields = ["match_id", "game_datetime", "game_version", "winner", "placement", "units"]

    def get_winner(self, obj):
        return str(obj.player) if obj.player else obj.puuid
