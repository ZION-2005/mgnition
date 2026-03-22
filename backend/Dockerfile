FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend/ /app/
# Keep catalog source available inside the backend container.
COPY mgnition-frontend/src/data/modelVariants.json /app/data/modelVariants.json

ENV MGNITION_VARIANT_DATA_PATH=/app/data/modelVariants.json \
    PORT=5001 \
    FLASK_DEBUG=0

EXPOSE 5001

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5001", "--timeout", "120", "app:app"]
