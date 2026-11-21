import os
import tempfile

os.environ.setdefault("AXIOM_MATCH_STORE", "sqlite")
os.environ.setdefault("AXIOM_DB", os.path.join(tempfile.gettempdir(), "axiom-pytest.db"))
