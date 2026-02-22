from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0009_comp_unit_count_constraints"),
    ]

    operations = [
        migrations.AlterField(
            model_name="comp",
            name="target_level",
            field=models.PositiveSmallIntegerField(default=9),
        ),
    ]
