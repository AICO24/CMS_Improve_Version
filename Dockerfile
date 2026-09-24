FROM php:8.2-apache

# Install PDO MySQL, cURL extensions, and CA certificates for secure cloud database connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcurl4-openssl-dev \
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

# Create required storage directories and set proper permissions
RUN mkdir -p /var/www/html/backend/storage/uploads \
    /var/www/html/backend/storage/logs \
    /var/www/html/backend/storage/rate_limits \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 775 /var/www/html/backend/storage

# Expose Render default port (10000)
ENV PORT=10000
EXPOSE ${PORT}

# Dynamically configure Apache to listen on Render's assigned $PORT at startup
CMD ["sh", "-c", "sed -i \"s/Listen [0-9]*/Listen ${PORT:-10000}/\" /etc/apache2/ports.conf && sed -i \"s/<VirtualHost \\*:[0-9]*>/<VirtualHost \\*:${PORT:-10000}>/\" /etc/apache2/sites-available/*.conf && exec apache2-foreground"]

