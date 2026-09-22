"""Bounded, ephemeral PTY relay. Terminal contents never enter jobs or audit."""
import asyncio
import json
import time

from fastapi import WebSocketDisconnect


async def agent_shell(socket, session):
    from speck.remote import close_session

    async def receive():
        while True:
            message = await socket.receive()
            if message['type'] == 'websocket.disconnect':
                return
            data = message.get('bytes')
            if data is not None:
                if len(data) > 16384:
                    raise ValueError('Shell output exceeds limit')
                await session.output.put(data)
            else:
                text = message.get('text', '')
                if len(text) > 256 or json.loads(text) != {'type': 'ready'} or session.ready.is_set():
                    raise ValueError('Invalid shell control message')
                session.ready.set()
                await session.output.put({'type': 'ready'})

    tasks = [asyncio.create_task(receive()), asyncio.create_task(session.finished.wait())]
    try:
        done, _ = await asyncio.wait(tasks, timeout=7200, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (TimeoutError, ValueError, WebSocketDisconnect, RuntimeError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # Drain final output before signalling EOF, unless the browser already left.
        if not session.finished.is_set():
            try:
                await asyncio.wait_for(session.output.put({'type': 'ended'}), 5)
                await asyncio.wait_for(session.finished.wait(), 5)
            except TimeoutError:
                pass
        await close_session(session.id)


async def browser_shell(socket, session, user):
    from speck.remote import close_session

    await socket.accept(subprotocol='speck-shell')
    session.browser = socket
    acknowledged = asyncio.Event()
    tasks = []

    async def output():
        # Waiting for PTY startup is bounded; merely connecting the agent isn't ready.
        first = True
        while True:
            message = await asyncio.wait_for(session.output.get(), 40 if first else 7200)
            first = False
            if isinstance(message, bytes):
                acknowledged.clear()
                await socket.send_bytes(message)
                # One frame in flight keeps a slow browser from accumulating output.
                await asyncio.wait_for(acknowledged.wait(), 30)
            else:
                await socket.send_json(message)
                if message['type'] == 'ended':
                    return

    async def input():
        while True:
            raw = await socket.receive_text()
            if len(raw) > 65536:
                raise ValueError('Shell input exceeds limit')
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ValueError('Invalid shell input')
            kind = message.get('type')
            if kind == 'ack':
                acknowledged.set()
                continue
            if not session.ready.is_set() or not session.agent:
                raise ValueError('Shell is not ready')
            if kind == 'input':
                data = message.get('data')
                if not isinstance(data, str) or len(data.encode('utf-8')) > 16384:
                    raise ValueError('Invalid shell input')
                clean = {'type': kind, 'data': data}
            elif kind == 'resize':
                cols, rows = message.get('cols'), message.get('rows')
                if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 500 or not 1 <= rows <= 200:
                    raise ValueError('Invalid terminal size')
                clean = {'type': kind, 'cols': cols, 'rows': rows}
            else:
                raise ValueError('Unknown shell input')
            await session.agent.send_json(clean)

    try:
        tasks = [asyncio.create_task(output()), asyncio.create_task(input()), asyncio.create_task(session.finished.wait())]
        done, _ = await asyncio.wait(tasks, timeout=max(0, min(session.created + 7200, user['expires']) - time.time()), return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (TimeoutError, ValueError, ConnectionError, WebSocketDisconnect, RuntimeError):
        try:
            await socket.send_json({'type': 'error', 'message': 'Shell connection ended. Check that the agent is online, then reconnect.'})
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.shield(close_session(session.id))
        await asyncio.gather(*tasks, return_exceptions=True)
