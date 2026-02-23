from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0012_comp_unit_star_constraints"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="excluded_unit_counts",
            field=models.JSONField(default=dict),
        ),
    ]
