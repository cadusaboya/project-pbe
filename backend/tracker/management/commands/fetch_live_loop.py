import time

from django.core.management.base import BaseCommand

from tracker.services.live_games import check_live_games


class Command(BaseCommand):
    help = (
        "Continuously check all tracked players for live TFT games "
        "and update the LiveGame table. Default interval is 120 seconds."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--interval",
            type=int,
            default=120,
            help="Seconds to wait between cycles (default: 120).",
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
                f"Starting live-game loop (interval={interval}s, "
                f"max_cycles={max_cycles or 'infinite'})."
            )
        )
        self.stdout.write("Press Ctrl+C to stop.\n")

        cycle = 0
        try:
            while True:
                cycle += 1
                self.stdout.write(
                    self.style.HTTP_INFO(f"[cycle {cycle}] checking live games...")
                )

                try:
                    live_count = check_live_games()
                    if live_count >= 0:
                        self.stdout.write(
                            f"[cycle {cycle}] found {live_count} live game(s)"
                        )
                    else:
                        self.stdout.write(
                            self.style.WARNING(
                                f"[cycle {cycle}] live game check failed (stale data kept)"
                            )
                        )
                except Exception as exc:
                    self.stdout.write(
                        self.style.WARNING(
                            f"[cycle {cycle}] live game check error: {exc}"
                        )
                    )

                if max_cycles and cycle >= max_cycles:
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Reached max_cycles={max_cycles}. Exiting."
                        )
                    )
                    break

                self.stdout.write(f"[cycle {cycle}] sleeping {interval}s...\n")
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("\nStopped by user.")
