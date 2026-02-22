import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        # ------------------------------------------------------------------ #
        # Player
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="Player",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("game_name", models.CharField(max_length=100)),
                ("tag_line", models.CharField(max_length=50)),
                (
                    "puuid",
                    models.CharField(
                        blank=True, max_length=200, null=True, unique=True
                    ),
                ),
            ],
        ),
        migrations.AlterUniqueTogether(
            name="player",
            unique_together={("game_name", "tag_line")},
        ),
        # ------------------------------------------------------------------ #
        # Match
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="Match",
            fields=[
                (
                    "match_id",
                    models.CharField(
                        max_length=100, primary_key=True, serialize=False
                    ),
                ),
                ("game_datetime", models.DateTimeField()),
                ("raw_json", models.JSONField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
        # ------------------------------------------------------------------ #
        # Unit
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="Unit",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("character_id", models.CharField(max_length=100, unique=True)),
            ],
        ),
        # ------------------------------------------------------------------ #
        # Participant
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="Participant",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("puuid", models.CharField(max_length=200)),
                ("placement", models.IntegerField()),
                ("level", models.IntegerField()),
                ("gold_left", models.IntegerField()),
                (
                    "match",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="participants",
                        to="tracker.match",
                    ),
                ),
                (
                    "player",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="participations",
                        to="tracker.player",
                    ),
                ),
            ],
        ),
        migrations.AlterUniqueTogether(
            name="participant",
            unique_together={("match", "puuid")},
        ),
        # ------------------------------------------------------------------ #
        # UnitUsage
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="UnitUsage",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("star_level", models.IntegerField(default=1)),
                ("rarity", models.IntegerField(default=0)),
                ("items", models.JSONField(default=list)),
                (
                    "participant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="unit_usages",
                        to="tracker.participant",
                    ),
                ),
                (
                    "unit",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="usages",
                        to="tracker.unit",
                    ),
                ),
            ],
        ),
        # ------------------------------------------------------------------ #
        # AggregatedUnitStat
        # ------------------------------------------------------------------ #
        migrations.CreateModel(
            name="AggregatedUnitStat",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("games", models.IntegerField(default=0)),
                ("total_placement", models.IntegerField(default=0)),
                ("avg_placement", models.FloatField(default=0.0)),
                ("top4_rate", models.FloatField(default=0.0)),
                ("win_rate", models.FloatField(default=0.0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "unit",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="stats",
                        to="tracker.unit",
                    ),
                ),
            ],
        ),
    ]
