from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0007_comp_conditions"),
    ]

    operations = [
        migrations.AddField(
            model_name="comp",
            name="max_trait_counts",
            field=models.JSONField(default=dict),
        ),
        migrations.AddField(
            model_name="comp",
            name="required_trait_breakpoints",
            field=models.JSONField(default=dict),
        ),
    ]
