#!/bin/bash
set -e

cd /app

# Run migrations
python manage.py migrate --noinput

# Start fetch loop in background (LIVE first, then PBE — auto-restarts on crash)
(while true; do
    python manage.py fetch_loop --interval 300
    echo "fetch_loop exited, restarting in 30s..."
    sleep 30
done) &

# Start gunicorn as main process
exec gunicorn tft_tracker.wsgi --bind 0.0.0.0:$PORT --workers 8 --threads 2 --timeout 60
