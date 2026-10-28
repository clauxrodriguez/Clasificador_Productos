import base64
import binascii
import json
import os
import re
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset" / "botella_agua"
PORT = int(os.environ.get("PORT", "8000"))


class ProjectHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if urlparse(self.path).path != "/api/capturas":
            self.send_error(404, "Ruta no encontrada")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            action = payload.get("action")
            image = payload.get("image", "")
            if action not in ("add", "remove"):
                raise ValueError("La acción debe ser add o remove")

            match = re.fullmatch(r"data:image/(jpeg|png);base64,(.+)", image)
            if not match:
                raise ValueError("La imagen no tiene un formato válido")

            extension, encoded = match.groups()
            try:
                image_bytes = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError("La imagen está dañada") from error

            if not image_bytes:
                raise ValueError("La imagen está vacía")

            DATASET.mkdir(parents=True, exist_ok=True)
            filename = f"captura_{action}_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{extension}"
            (DATASET / filename).write_bytes(image_bytes)
            self._send_json(200, {"ok": True, "filename": filename})
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"ok": False, "error": str(error)})
        except OSError as error:
            self._send_json(500, {"ok": False, "error": f"No se pudo guardar la captura: {error}"})

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Servidor disponible en http://127.0.0.1:{PORT}")
    print(f"Las capturas se guardan en: {DATASET}")
    ThreadingHTTPServer(("0.0.0.0", PORT), ProjectHandler).serve_forever()
