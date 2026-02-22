from django.db import migrations


def set_existing_comps_target_level_9(apps, schema_editor):
    Comp = apps.get_model("tracker", "Comp")
    Comp.objects.all().update(target_level=9)


class Migration(migrations.Migration):

    dependencies = [
        ("tracker", "0010_alter_comp_target_level_default_9"),
    ]

    operations = [
        migrations.RunPython(
            set_existing_comps_target_level_9,
            migrations.RunPython.noop,
        ),
    ]
