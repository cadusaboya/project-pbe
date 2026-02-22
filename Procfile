web: cd backend && python manage.py migrate --noinput && gunicorn tft_tracker.wsgi --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60
