from pathlib import Path
from urllib.request import urlopen

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from directory.greek_postcodes import NOTICE, SOURCE, import_greek_csv


class Command(BaseCommand):
    help = "Fill the Greek postcode-data gap using the official Eurostat GISCO source."

    def add_arguments(self, parser):
        parser.add_argument("--file", type=Path, help="Import a previously downloaded official GISCO CSV.")

    def handle(self, *args, **options):
        target = options["file"]
        try:
            if not target:
                cache = settings.BASE_DIR.parent / ".local/gisco"
                cache.mkdir(parents=True, exist_ok=True)
                target = cache / "PCODE_PT_2025_4326.csv"
                temporary = target.with_suffix(".part")
                with urlopen(SOURCE, timeout=30) as response, temporary.open("wb") as output:
                    size = 0
                    while block := response.read(1024 * 1024):
                        size += len(block)
                        if size > 250 * 1024 * 1024:
                            raise ValueError("GISCO source exceeds the 250 MB download limit.")
                        output.write(block)
                temporary.replace(target)
                (cache / "ATTRIBUTION.txt").write_text(NOTICE + "\n" + SOURCE + "\n", encoding="utf-8")
            dataset = import_greek_csv(target)
        except (OSError, ValueError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(f"Imported {dataset.row_count} Greek postcode/local-area rows from Eurostat GISCO."))
