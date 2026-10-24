# Luminor on Hugging Face Spaces (Docker SDK): public, read-only demo
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Demo images: anonymized LIDC-IDRI chest CTs from TCIA (CC BY 3.0), fetched at build time
COPY fetch_tcia.py .
RUN python fetch_tcia.py /app/data

COPY server.py LICENSE NOTICE ./
COPY static ./static
COPY docs ./docs

# Hugging Face runs the container as user 1000
RUN useradd -m -u 1000 user
USER user

EXPOSE 7860
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "7860", "--data", "/app/data", "--public"]
