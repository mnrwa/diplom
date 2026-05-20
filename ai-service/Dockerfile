FROM python:3.11-slim

WORKDIR /app

# System deps needed by playwright, lxml, sentencepiece
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install CPU-only PyTorch first (avoids pulling 2 GB CUDA build)
RUN pip install --no-cache-dir \
    torch==2.2.2 \
    --index-url https://download.pytorch.org/whl/cpu

# Install the rest of the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (only chromium, minimal footprint)
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
