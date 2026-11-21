from fastapi.testclient import TestClient

from app.main import app


def test_backend_prefixed_routes_match_fastapi_routes():
    client = TestClient(app)
    for path in ("/health", "/backend/health", "/api/stages", "/backend/api/stages"):
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)


def test_backend_prefix_does_not_change_json_contract():
    client = TestClient(app)
    direct = client.get("/api/stages").json()
    prefixed = client.get("/backend/api/stages").json()
    assert prefixed == direct
