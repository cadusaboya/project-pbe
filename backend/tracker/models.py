from django.db import models

SERVER_CHOICES = [("PBE", "PBE"), ("LIVE", "Live"), ("SCRIMS", "Scrims")]


class Player(models.Model):
    game_name = models.CharField(max_length=100)
    tag_line = models.CharField(max_length=50)
    puuid = models.CharField(max_length=200, unique=True, blank=True, null=True)
    region = models.CharField(max_length=10, default="PBE", db_index=True)
    last_seen_match_id = models.CharField(max_length=100, blank=True, null=True)
    last_polled_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = [("game_name", "tag_line", "region")]

    def __str__(self):
        return f"{self.game_name}#{self.tag_line}"


class Match(models.Model):
    match_id = models.CharField(max_length=100, primary_key=True)
    game_datetime = models.DateTimeField(db_index=True)
    game_version = models.CharField(max_length=100, default="16.6 PBE Alpha - No Items THex", db_index=True)
    server = models.CharField(max_length=10, choices=SERVER_CHOICES, default="PBE", db_index=True)
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
    placement = models.IntegerField(db_index=True)
    level = models.IntegerField(db_index=True)
    gold_left = models.IntegerField()

    class Meta:
        unique_together = [("match", "puuid")]
        indexes = [
            models.Index(fields=["match", "player"], name="idx_participant_match_player"),
        ]

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
    star_level = models.IntegerField(default=1, db_index=True)
    rarity = models.IntegerField(default=0)
    items = models.JSONField(default=list)

    def __str__(self):
        return f"{self.unit.character_id} ({self.star_level}★)"


class AggregatedUnitStat(models.Model):
    unit = models.ForeignKey(
        Unit, on_delete=models.CASCADE, related_name="stats"
    )
    server = models.CharField(max_length=10, choices=SERVER_CHOICES, default="PBE", db_index=True)
    games = models.IntegerField(default=0)
    total_placement = models.IntegerField(default=0)
    avg_placement = models.FloatField(default=0.0)
    top4_rate = models.FloatField(default=0.0)
    win_rate = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("unit", "server")]

    def __str__(self):
        return f"Stats for {self.unit.character_id} ({self.server})"


class Comp(models.Model):
    name = models.CharField(max_length=120)
    server = models.CharField(max_length=10, choices=SERVER_CHOICES, default="PBE", db_index=True)
    units = models.JSONField(default=list)
    target_level = models.PositiveSmallIntegerField(default=9)
    excluded_units = models.JSONField(default=list)
    excluded_unit_counts = models.JSONField(default=dict)
    required_traits = models.JSONField(default=list)
    required_unit_counts = models.JSONField(default=dict)
    required_unit_star_levels = models.JSONField(default=dict)
    required_unit_item_counts = models.JSONField(default=dict)
    required_trait_breakpoints = models.JSONField(default=dict)
    excluded_traits = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("name", "server")]
        ordering = ["name"]

    def __str__(self):
        return self.name
