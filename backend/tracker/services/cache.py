"""
Simple in-memory cache that invalidates when a version counter changes.

Used to replace ad-hoc global dict + version dict patterns in views.
"""


class VersionedCache:
    """In-memory cache keyed by (server, ...) that auto-invalidates when a
    per-server version counter changes (e.g. Match.objects.count())."""

    def __init__(self):
        self._data: dict = {}
        self._version: dict = {}

    def get(self, key, current_version):
        """Return cached value if version matches, else None."""
        cache_key = key if isinstance(key, tuple) else (key,)
        server = cache_key[0]
        if self._version.get(server) != current_version:
            # Invalidate all entries for this server
            stale = [k for k in self._data if k[0] == server]
            for k in stale:
                del self._data[k]
            self._version[server] = current_version
            return None
        return self._data.get(cache_key)

    def set(self, key, value, current_version):
        """Store a value in the cache, keyed by server version."""
        cache_key = key if isinstance(key, tuple) else (key,)
        server = cache_key[0]
        self._version[server] = current_version
        self._data[cache_key] = value
