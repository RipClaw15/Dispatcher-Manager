"""EEA scope checked against https://www.gov.uk/eu-eea (2026-10-30)."""
EEA_COUNTRIES = tuple("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split())
EEA_UK_COUNTRIES = tuple(sorted((*EEA_COUNTRIES, "GB")))
UK_REGIONS = {"GB-ENG": "England", "GB-SCT": "Scotland", "GB-WLS": "Wales", "GB-NIR": "Northern Ireland"}
PREFIX_COUNTRIES = {"GB", "NL", "IE", "MT"}
