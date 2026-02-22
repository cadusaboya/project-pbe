from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0004_comp"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="excluded_units",
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name="comp",
            name="target_level",
            field=models.PositiveSmallIntegerField(default=8),
        ),
    ]
