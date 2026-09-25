"""Serve the HMI and proxy KCL requests to the local FANUC web server."""
import base64
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 8000
ROBOT_COMSET_URL = "http://127.0.0.1/karel/ComSet"
ROBOT_IOSTATE_URL = "http://127.0.0.1/MD/IOSTATE.DG"
ROBOT_NUMREG_URL = "http://127.0.0.1/MD/NUMREG.VA"
ROBOT_USERNAME = os.getenv("FANUC_USERNAME")
ROBOT_PASSWORD = os.getenv("FANUC_PASSWORD")


class HMIRequestHandler(SimpleHTTPRequestHandler):
    """Does what it says on the tin; Handles requests from the HMI"""
    def do_GET(self):
        if self.path == "/karel/ComSet" or self.path.startswith("/karel/ComSet?"):
            self.proxy_robot_request(ROBOT_COMSET_URL)
            return
        if self.path == "/MD/IOSTATE.DG":
            self.proxy_robot_request(ROBOT_IOSTATE_URL)
            return
        if self.path == "/MD/NUMREG.VA":
            self.proxy_robot_request(ROBOT_NUMREG_URL)
            return
        super().do_GET()

    def proxy_robot_request(self, robot_base_url):
        """Sends robot requests received from the website to the actual robot"""
        query = self.path.partition("?")[2]
        robot_url = f"{robot_base_url}{'?' + query if query else ''}"
        robot_request = Request(robot_url)
        if ROBOT_USERNAME and ROBOT_PASSWORD:
            credentials = f"{ROBOT_USERNAME}:{ROBOT_PASSWORD}".encode()
            encoded_credentials = base64.b64encode(credentials).decode()
            robot_request.add_header("Authorization", f"Basic {encoded_credentials}")
        try:
            with urlopen(robot_request, timeout=10) as robot_response:
                response_body = robot_response.read()
                response_status = robot_response.status
                if b"krlerr1" in response_body.lower():
                    response_status = 502
                self.send_response(response_status)
                self.send_header("Content-Type", robot_response.headers.get_content_type())
                self.send_header("Content-Length", str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
        except HTTPError as error:
            response_body = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except (URLError, TimeoutError) as error:
            response_body = f"Robot unavailable at 127.0.0.1: {error}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)


if __name__ == "__main__":
    # Hosts the actual web server
    workspace = Path(__file__).resolve().parent
    server = ThreadingHTTPServer((HOST, PORT), HMIRequestHandler)
    print(f"HMI available at http://{HOST}:{PORT}/index.html")
    print(f"Serving files from {workspace}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping HMI server")
    finally:
        server.server_close()
