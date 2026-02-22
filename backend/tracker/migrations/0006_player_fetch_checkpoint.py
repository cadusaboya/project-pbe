from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0005_comp_level_exclusions"),
    ]

    operations = [
        migrations.AddField(
            model_name="player",
            name="last_polled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="player",
            name="last_seen_match_id",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
