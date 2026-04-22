import asyncio
import logging
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.database import get_db
from app.models import Branch, Project
from app.worker.docker_manager import DockerManager
from app.core.security import decode_token

router = APIRouter(prefix="/terminal", tags=["terminal"])
logger = logging.getLogger(__name__)

async def authenticate_ws(websocket: WebSocket, token: str) -> dict:
    try:
        payload = decode_token(token)
        return payload
    except Exception:
        await websocket.close(code=1008, reason="Unauthorized")
        return None

@router.websocket("/{branch_id}")
async def terminal_endpoint(
    websocket: WebSocket,
    branch_id: str,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    payload = await authenticate_ws(websocket, token)
    if not payload:
        return

    await websocket.accept()

    try:
        branch = await db.get(Branch, uuid.UUID(branch_id))
    except ValueError:
        branch = None

    if not branch:
        await websocket.send_text("Branch not found.\r\n")
        await websocket.close()
        return

    project = await db.get(Project, branch.project_id)
    
    docker_mgr = DockerManager()
    container_name = docker_mgr.get_container_name(project.slug, branch.name)
    
    container = docker_mgr.get_container(container_name)
    if not container or container.status != "running":
        await websocket.send_text(f"Container {container_name} is not running.\r\n")
        await websocket.close()
        return

    # Use low-level API to get a socket
    client = docker_mgr.client.api
    try:
        exec_id = client.exec_create(
            container.id,
            cmd=["/bin/bash"],
            stdin=True,
            stdout=True,
            stderr=True,
            tty=True,
            user="odoo" # Default user
        )["Id"]
        
        sock = client.exec_start(exec_id, socket=True)
        # docker-py might return a wrapper. We need the underlying fd.
        if hasattr(sock, "_sock"):
            sock = sock._sock
        elif hasattr(sock, "fp") and hasattr(sock.fp, "raw") and hasattr(sock.fp.raw, "_sock"):
            sock = sock.fp.raw._sock
            
        sock.setblocking(False)
        loop = asyncio.get_running_loop()

        async def _read_from_docker():
            try:
                while True:
                    data = await loop.sock_recv(sock, 4096)
                    if not data:
                        break
                    # Send bytes directly. xterm.js handles bytes well if wrapped or we can decode.
                    # WebSocket in FastAPI allows send_bytes or send_text.
                    await websocket.send_text(data.decode("utf-8", errors="replace"))
            except Exception as e:
                logger.error(f"Docker read error: {e}")

        async def _write_to_docker():
            try:
                while True:
                    data = await websocket.receive_text()
                    await loop.sock_sendall(sock, data.encode('utf-8'))
            except WebSocketDisconnect:
                pass
            except Exception as e:
                logger.error(f"WS read error: {e}")

        read_task = asyncio.create_task(_read_from_docker())
        write_task = asyncio.create_task(_write_to_docker())

        done, pending = await asyncio.wait(
            [read_task, write_task], 
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            
    except Exception as e:
        await websocket.send_text(f"\r\nError: {e}\r\n")
    finally:
        try:
            sock.close()
        except:
            pass
        try:
            await websocket.close()
        except:
            pass
