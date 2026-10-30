import json
from pathlib import Path
from urllib.request import urlopen

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from directory.eurostat_postcodes import NOTICE, SOURCE, import_eurostat_csv


class Command(BaseCommand):
    help = "Download/import Eurostat postcode data for all 30 EEA countries; retain the separate UK dataset."

    def add_arguments(self, parser):
        parser.add_argument("--file", type=Path, help="Use the downloaded official 2025 Eurostat CSV.")

    def handle(self, *args, **options):
        cache = settings.BASE_DIR.parent / ".local/gisco"
        cache.mkdir(parents=True, exist_ok=True)
        target = options["file"] or cache / "PCODE_PT_2025_4326.csv"
        try:
            if not target.exists():
                temporary = target.with_suffix(".part")
                with urlopen(SOURCE, timeout=30) as response, temporary.open("wb") as output:
                    size = 0
                    while block := response.read(1024 * 1024):
                        size += len(block)
                        if size > 250 * 1024 * 1024:
                            raise ValueError("Eurostat source exceeds the 250 MB download limit.")
                        output.write(block)
                temporary.replace(target)
            def progress(country, count):
                self.stdout.write(f"{country}: imported {count} Eurostat postcode/local-area records.")
                self.stdout.flush()
            counts = import_eurostat_csv(target, progress=progress)
            (cache / "ATTRIBUTION.txt").write_text(NOTICE + "\n" + SOURCE + "\n", encoding="utf-8")
            (cache / "import-report.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")
        except (OSError, ValueError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(f"Imported all {len(counts)} EEA datasets ({sum(counts.values())} records). UK data is retained separately."))
