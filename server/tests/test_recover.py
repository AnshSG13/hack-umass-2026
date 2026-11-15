"""Saves left half-read by a restart: which ones count as stuck, and how they start again.
A small in-memory stand-in for the three collections; no network."""
from datetime import datetime, timedelta, timezone

from realize import recover

NOW = datetime(2026, 11, 15, 2, 0, tzinfo=timezone.utc)


class Coll:
    def __init__(self, docs):
        self.docs = docs

    @staticmethod
    def _match(d, q):
        for k, v in q.items():
            have = d.get(k)
            if isinstance(v, dict):
                if "$in" in v and have not in v["$in"]:
                    return False
                if "$lt" in v and not (have is not None and have < v["$lt"]):
                    return False
                if "$gte" in v and not (have is not None and have >= v["$gte"]):
                    return False
            elif have != v:
                return False
        return True

    def find(self, q, proj=None):
        class Cur(list):
            def limit(self, n):
                return Cur(self[:n])
        return Cur([d for d in self.docs if self._match(d, q)])

    def find_one(self, q, proj=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def update_one(self, q, u):
        for d in self.docs:
            if self._match(d, q):
                d.update(u.get("$set", {}))
                return

    def update_many(self, q, u):
        for d in self.docs:
            if self._match(d, q):
                d.update(u.get("$set", {}))


def _setup(monkeypatch, saves, jobs=(), runs=()):
    s, j, r = Coll(list(saves)), Coll(list(jobs)), Coll(list(runs))
    monkeypatch.setattr(recover.db, "saves", lambda: s)
    monkeypatch.setattr(recover.db, "jobs", lambda: j)
    monkeypatch.setattr(recover.db, "agent_runs", lambda: r)
    return s, j, r


def test_only_old_quiet_saves_with_no_job_are_stuck(monkeypatch):
    old = NOW - timedelta(hours=5)
    saves = [
        {"_id": 1, "user_id": "u", "status": "reading", "created_at": old},                     # stuck
        {"_id": 2, "user_id": "u", "status": "reading", "created_at": NOW - timedelta(minutes=2)},  # just saved
        {"_id": 3, "user_id": "u", "status": "queued", "created_at": old},                      # has a live job
        {"_id": 4, "user_id": "u", "status": "planning", "created_at": old},                    # a run just started
        {"_id": 5, "user_id": "u", "status": "ready", "created_at": old},                       # done
    ]
    jobs = [{"save_id": 3, "status": "pending"}]
    runs = [{"save_id": 4, "started_at": NOW - timedelta(minutes=1), "status": "running"},
            {"save_id": 1, "started_at": old, "status": "running"}]
    _setup(monkeypatch, saves, jobs, runs)
    assert [s["_id"] for s in recover.stale_saves(NOW)] == [1]


def test_a_stuck_save_is_planned_again_the_way_it_started(monkeypatch):
    old = NOW - timedelta(hours=5)
    saves, _, runs = _setup(monkeypatch, [
        {"_id": 1, "user_id": "u", "status": "reading", "created_at": old, "from_cache": True, "shortcode": "A"},
        {"_id": 2, "user_id": "u", "status": "reading", "created_at": old, "shortcode": "B"},
    ], runs=[{"save_id": 1, "started_at": old, "status": "running"}])
    planned, enqueued = [], []
    import realize.demo as demo

    monkeypatch.setattr(demo, "plan_sample", lambda sid, uid: planned.append(sid))
    monkeypatch.setattr(recover.jobs, "enqueue", lambda kind, save: enqueued.append((kind, save["_id"])))
    assert recover.sweep(NOW) == 2
    assert planned == [1] and enqueued == [("propose", 2)]
    assert runs.docs[0]["status"] == "failed"  # the run the restart killed is closed
    assert all(d["status"] == "queued" for d in saves.docs)
