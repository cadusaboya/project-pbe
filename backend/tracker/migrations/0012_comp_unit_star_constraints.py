from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0011_set_existing_comps_target_level_9"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="required_unit_star_levels",
            field=models.JSONField(default=dict),
        ),
    ]
