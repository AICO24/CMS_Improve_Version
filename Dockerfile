FROM php:8.2-apache

# Install PDO MySQL, cURL, CA certificates, Python 3, pip, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    libcurl4-openssl-dev \
    build-essential \
    && docker-php-ext-install pdo pdo_mysql curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Enable Apache rewrite and headers modules for routing & CORS
RUN a2enmod rewrite headers

# Configure AllowOverride All for .htaccess support
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

WORKDIR /var/www/html

# Copy codebase
COPY . /var/www/html/

# Setup Python virtual environment and install AI dependencies
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r /var/www/html/python-ai/requirements.txt

# Create required storage directories and set proper permissions
RUN mkdir -p /var/www/html/backend/storage/uploads \
    /var/www/html/backend/storage/logs \
    /var/www/html/backend/storage/rate_limits \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 775 /var/www/html/backend/storage

# Expose Render default port (10000)
ENV PORT=10000
EXPOSE ${PORT}

# Dynamically configure Apache port, start Python AI service in background, and start Apache in foreground
CMD ["sh", "-c", "sed -i \"s/Listen [0-9]*/Listen ${PORT:-10000}/\" /etc/apache2/ports.conf && sed -i \"s/<VirtualHost \\*:[0-9]*>/<VirtualHost \\*:${PORT:-10000}>/\" /etc/apache2/sites-available/*.conf && (cd /var/www/html/python-ai && gunicorn --bind 127.0.0.1:5000 app:app --timeout 120 --workers 1 --threads 4 &) && exec apache2-foreground"]


