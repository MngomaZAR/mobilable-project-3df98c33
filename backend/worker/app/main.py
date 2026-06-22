import asyncio
import logging
import os
import signal


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("papzi-worker")


async def run() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    logger.info("PAPZII worker started")
    await stop.wait()
    logger.info("PAPZII worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
