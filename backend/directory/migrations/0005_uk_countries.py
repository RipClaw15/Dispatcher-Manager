import json
from pathlib import Path

from django.db import migrations, models


def seed_uk_countries(apps, schema_editor):
    Country = apps.get_model("directory", "Country")
    database = schema_editor.connection.alias
    data = json.loads((Path(__file__).resolve().parents[1] / "data/uk-countries.json").read_text(encoding="utf-8"))
    for item in data:
        existing = Country.objects.using(database).filter(name__iexact=item["name"]).first()
        if existing is None:
            Country.objects.using(database).create(**item, is_custom=False)
            continue
        # Keep existing IDs and old codes resolvable if someone already added
        # one of these entries manually before it was part of the directory.
        aliases = list(dict.fromkeys([*existing.aliases, *item["aliases"],
                                     *([existing.code] if existing.code and existing.code != item["code"] else [])]))
        if existing.code != item["code"] or existing.aliases != aliases or existing.is_custom:
            existing.code = item["code"]
            existing.aliases = aliases
            existing.is_custom = False
            existing.version += 1
            existing.save(using=database)


def restore_short_codes(apps, schema_editor):
    Country = apps.get_model("directory", "Country")
    database = schema_editor.connection.alias
    for country in Country.objects.using(database).filter(code__contains="-"):
        country.aliases = list(dict.fromkeys([*country.aliases, country.code]))
        country.code = ""
        country.version += 1
        country.save(using=database)


class Migration(migrations.Migration):
    dependencies = [("directory", "0004_seed_countries")]

    operations = [
        migrations.RemoveConstraint(model_name="country", name="country_code_two_letters"),
        migrations.AlterField(model_name="country", name="code", field=models.CharField(blank=True, max_length=6)),
        migrations.AddConstraint(model_name="country", constraint=models.CheckConstraint(
            condition=models.Q(code="") | models.Q(code__regex=r"^[A-Z]{2}(-[A-Z]{3})?$"), name="country_or_region_code")),
        migrations.RunPython(seed_uk_countries, restore_short_codes),
    ]
