from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("fleet", "0002_alter_driver_partner_alter_vehicle_partner")]

    operations = [
        migrations.AddField(
            model_name="driver",
            name="citizenship",
            field=models.CharField(blank=True, max_length=80),
        ),
    ]
