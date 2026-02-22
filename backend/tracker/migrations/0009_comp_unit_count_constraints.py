from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0008_comp_trait_constraints"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="required_unit_counts",
            field=models.JSONField(default=dict),
        ),
    ]
