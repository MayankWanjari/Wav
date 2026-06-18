import os
from dotenv import load_dotenv
load_dotenv()  # loads .env file if present (ignored in production where env vars are set directly)

from app import check_dependencies, create_app

app = create_app()

if __name__ == "__main__":
    check_dependencies()
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=5000, use_reloader=False)
