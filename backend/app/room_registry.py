"""Process-local room reservations and quick-match queue.

State is intentionally in-memory: a reservation is short lived and a matched
group only needs a code long enough to open its socket.
"""
from __future__ import annotations

import secrets
import string
import time
from dataclasses import dataclass
from typing import Callable, Iterable

CODE_ALPHABET = (
    string.ascii_uppercase.replace("O", "").replace("I", "")
    + string.digits.replace("0", "").replace("1", "")
)
CODE_LENGTH = 4


@dataclass(frozen=True)
class Reservation:
    room_id: str
    code: str
    min_players: int
    created_at: float
    expires_at: float


class RoomRegistry:
    def __init__(
        self,
        clock: Callable[[], float] = time.time,
        reservation_ttl: float = 600.0,
        queue_ttl: float = 60.0,
    ):
        self._clock = clock
        self.reservation_ttl = reservation_ttl
        self.queue_ttl = queue_ttl
        self._reservations: dict[str, Reservation] = {}
        self._queue: dict[str, float] = {}
        self._matched: dict[str, tuple[str, float]] = {}

    def _now(self) -> float:
        return self._clock()

    def prune(self) -> None:
        now = self._now()
        for code in [c for c, r in self._reservations.items() if r.expires_at <= now]:
            self._reservations.pop(code, None)
        for key in [k for k, expiry in self._queue.items() if expiry <= now]:
            self._queue.pop(key, None)
        for key in [k for k, (_, expiry) in self._matched.items() if expiry <= now]:
            self._matched.pop(key, None)

    def _new_code(self, taken: Iterable[str]) -> str:
        blocked = {str(code).strip().upper() for code in taken}
        for _ in range(100):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in blocked:
                return code
        raise RuntimeError("Could not allocate a unique room code.")

    def reserve(self, min_players: int = 1, existing_codes: Iterable[str] = ()) -> Reservation:
        self.prune()
        code = self._new_code(set(self._reservations) | set(existing_codes))
        now = self._now()
        reservation = Reservation(
            room_id=f"R{secrets.token_hex(6).upper()}",
            code=code,
            min_players=min_players,
            created_at=now,
            expires_at=now + self.reservation_ttl,
        )
        self._reservations[code] = reservation
        return reservation

    def get_reservation(self, code: str) -> Reservation | None:
        self.prune()
        return self._reservations.get(str(code).strip().upper())

    def consume(self, code: str) -> Reservation | None:
        self.prune()
        return self._reservations.pop(str(code).strip().upper(), None)

    def restore(self, reservation: Reservation) -> None:
        if reservation.expires_at <= self._now():
            return
        self._reservations.setdefault(reservation.code, reservation)

    def hold(self, code: str, room_id: str, min_players: int) -> Reservation:
        self.prune()
        normalized = str(code).strip().upper()
        now = self._now()
        reservation = Reservation(
            room_id=room_id,
            code=normalized,
            min_players=min_players,
            created_at=now,
            expires_at=now + self.reservation_ttl,
        )
        self._reservations[normalized] = reservation
        return reservation

    def queue(
        self,
        client_key: str,
        min_players: int = 2,
        existing_codes: Iterable[str] = (),
    ) -> dict:
        self.prune()
        key = str(client_key or "").strip()[:128]
        if not key:
            raise ValueError("client_key is required.")
        if key in self._queue:
            return {"status": "queued", "position": list(self._queue).index(key) + 1}
        if key in self._matched:
            return {"status": "matched", "code": self._matched[key][0]}

        self._queue[key] = self._now() + self.queue_ttl
        waiting = list(self._queue)
        if len(waiting) < max(1, min_players):
            return {"status": "queued", "position": len(waiting)}

        chosen = waiting[: max(1, min_players)]
        for waiting_key in chosen:
            self._queue.pop(waiting_key, None)
        reservation = self.reserve(min_players, existing_codes)
        for waiting_key in chosen:
            self._matched[waiting_key] = (reservation.code, reservation.expires_at)
        return {"status": "matched", "code": reservation.code}

    def queue_status(self, client_key: str) -> dict | None:
        self.prune()
        key = str(client_key or "").strip()[:128]
        if key in self._queue:
            return {"status": "queued", "position": list(self._queue).index(key) + 1}
        if key in self._matched:
            return {"status": "matched", "code": self._matched[key][0]}
        return None
