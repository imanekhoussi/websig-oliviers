FROM python:3.11-slim

# Dépendances système nécessaires pour GDAL/rasterio/pyproj/geopandas
RUN apt-get update && apt-get install -y --no-install-recommends \
        gdal-bin \
        libgdal-dev \
        libproj-dev \
        libgeos-dev \
        libspatialindex-dev \
        gcc \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Variables d'environnement pour la compilation GDAL Python
ENV GDAL_CONFIG=/usr/bin/gdal-config
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app

# Installer les dépendances en premier (meilleur cache Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

# Copier le code source
COPY . .

# Créer les répertoires de données au démarrage
RUN mkdir -p data/missions uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
