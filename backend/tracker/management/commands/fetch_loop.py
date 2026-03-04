import time

from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Continuously fetch LIVE matches, refresh unit stats, wait, and repeat. "
        "Default interval is 300 seconds."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--interval",
            type=int,
            default=300,
            help="Seconds to wait between cycles (default: 300).",
        )
        parser.add_argument(
            "--max-cycles",
            type=int,
            default=0,
            help="Stop after N cycles. Use 0 for infinite loop (default: 0).",
        )

    def handle(self, *args, **options):
        interval = max(1, int(options["interval"]))
        max_cycles = max(0, int(options["max_cycles"]))

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting fetch loop: LIVE only (interval={interval}s, "
                f"max_cycles={max_cycles or 'infinite'})."
            )
        )
        self.stdout.write("Press Ctrl+C to stop.\n")

        cycle = 0
        try:
            while True:
                cycle += 1

                # --- LIVE ---
                try:
                    self.stdout.write(self.style.HTTP_INFO(f"[cycle {cycle}] running fetch_live..."))
                    call_command("fetch_live")
                except Exception as exc:
                    self.stderr.write(
                        self.style.ERROR(f"[cycle {cycle}] fetch_live failed: {exc}")
                    )

                if max_cycles and cycle >= max_cycles:
                    self.stdout.write(self.style.SUCCESS(f"Reached max_cycles={max_cycles}. Exiting."))
                    break

                self.stdout.write(f"[cycle {cycle}] sleeping {interval}s...\n")
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("\nStopped by user.")
