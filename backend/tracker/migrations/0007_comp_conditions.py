from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0006_player_fetch_checkpoint"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="required_traits",
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name="comp",
            name="required_unit_item_counts",
            field=models.JSONField(default=dict),
        ),
    ]
