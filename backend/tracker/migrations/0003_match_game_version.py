from django.db import migrations, models


def backfill_game_version(apps, schema_editor):
    Match = apps.get_model("tracker", "Match")
    Match.objects.update(game_version="16.6 PBE Alpha")


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0002_add_cost_traits_to_unit"),
    ]

    operations = [
        migrations.AddField(
            model_name="match",
            name="game_version",
            field=models.CharField(default="16.6 PBE Alpha - No Items THex", max_length=100),
        ),
        migrations.RunPython(backfill_game_version, migrations.RunPython.noop),
    ]
