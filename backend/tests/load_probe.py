import argparse
import asyncio
import json
import os
import statistics
import time

import websockets


def percentile(values, fraction):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(len(ordered) * fraction) - 1))
    return ordered[index]


async def client(index, room, url, connects, rtts):
    started = time.perf_counter()
    async with websockets.connect(
        f"{url}/ws/{room}?name=load{index}&pid=load-{index}"
    ) as ws:
        welcome = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        if welcome.get("type") != "welcome":
            raise RuntimeError(f"unexpected welcome: {welcome}")
        connects.append((time.perf_counter() - started) * 1000)
        for _ in range(3):
            sent = time.perf_counter()
            await ws.send(json.dumps({"type": "ping"}))
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if message.get("type") == "pong":
                    rtts.append((time.perf_counter() - sent) * 1000)
                    break


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clients", type=int, default=4)
    parser.add_argument("--room", default="LOADPROBE")
    parser.add_argument("--url", default=os.getenv("AXIOM_WS", "ws://localhost:8000"))
    args = parser.parse_args()
    connects = []
    rtts = []
    await asyncio.gather(*(
        client(index, args.room, args.url, connects, rtts)
        for index in range(args.clients)
    ))
    print(json.dumps({
        "clients": args.clients,
        "connect_ms_p50": round(percentile(connects, 0.5), 2),
        "connect_ms_p95": round(percentile(connects, 0.95), 2),
        "rtt_ms_p50": round(statistics.median(rtts), 2) if rtts else 0,
        "rtt_ms_p95": round(percentile(rtts, 0.95), 2),
        "samples": len(rtts),
    }, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
