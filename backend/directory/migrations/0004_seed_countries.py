import json
from pathlib import Path
from django.db import migrations


def seed_countries(apps, schema_editor):
    Country = apps.get_model("directory", "Country")
    data = json.loads((Path(__file__).resolve().parents[1] / "data/europe-countries.json").read_text(encoding="utf-8"))
    Country.objects.bulk_create([Country(**item, is_custom=False) for item in data], ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [("directory", "0003_country")]
    operations = [migrations.RunPython(seed_countries, migrations.RunPython.noop)]
