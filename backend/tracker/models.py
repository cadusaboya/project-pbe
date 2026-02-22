from django.db import models


class Player(models.Model):
    game_name = models.CharField(max_length=100)
    tag_line = models.CharField(max_length=50)
    puuid = models.CharField(max_length=200, unique=True, blank=True, null=True)
    last_seen_match_id = models.CharField(max_length=100, blank=True, null=True)
    last_polled_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = [("game_name", "tag_line")]

    def __str__(self):
        return f"{self.game_name}#{self.tag_line}"


class Match(models.Model):
    match_id = models.CharField(max_length=100, primary_key=True)
    game_datetime = models.DateTimeField()
    game_version = models.CharField(max_length=100, default="16.6 PBE Alpha - No Items THex")
    raw_json = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.match_id


class Participant(models.Model):
    match = models.ForeignKey(
        Match, on_delete=models.CASCADE, related_name="participants"
    )
    player = models.ForeignKey(
        Player,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="participations",
    )
    puuid = models.CharField(max_length=200)
    placement = models.IntegerField()
    level = models.IntegerField()
    gold_left = models.IntegerField()

    class Meta:
        unique_together = [("match", "puuid")]

    def __str__(self):
        return f"{self.match_id} – {self.puuid[:12]}… (#{self.placement})"


class Unit(models.Model):
    character_id = models.CharField(max_length=100, unique=True)
    cost = models.PositiveSmallIntegerField(default=0)
    traits = models.JSONField(default=list)

    def __str__(self):
        return self.character_id


class UnitUsage(models.Model):
    participant = models.ForeignKey(
        Participant, on_delete=models.CASCADE, related_name="unit_usages"
    )
    unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name="usages")
    star_level = models.IntegerField(default=1)
    rarity = models.IntegerField(default=0)
    items = models.JSONField(default=list)

    def __str__(self):
        return f"{self.unit.character_id} ({self.star_level}★)"


class AggregatedUnitStat(models.Model):
    unit = models.OneToOneField(
        Unit, on_delete=models.CASCADE, related_name="stats"
    )
    games = models.IntegerField(default=0)
    total_placement = models.IntegerField(default=0)
    avg_placement = models.FloatField(default=0.0)
    top4_rate = models.FloatField(default=0.0)
    win_rate = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Stats for {self.unit.character_id}"


class Comp(models.Model):
    name = models.CharField(max_length=120, unique=True)
    units = models.JSONField(default=list)
    target_level = models.PositiveSmallIntegerField(default=8)
    excluded_units = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
